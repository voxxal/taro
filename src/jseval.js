import { TaroError } from "./util.js";
let line = 0;

const buildTypes = (...transl) => {
  let types = {};
  for (const [taroTypes, jsType] of transl) {
    for (const taroType of taroTypes) {
      types[taroType] = jsType
    }
  }
  return types;
}

const TYPES = buildTypes(
  [ ["i32", "i64", "f32", "f64", "v128"], "number" ],
  [ ["bool"], "boolean" ],
  [ ["string"], "string" ],

)

export class TaroCallable {
  constructor(arity) {
    this.arity = arity;
  }
}

export class JsFunc extends TaroCallable {
  constructor(func, arity) {
    super(arity ?? func.length)
    this.call = (_, args) => func(...args);
  }
}

export class TaroFunc extends TaroCallable {
  constructor(node) {
    super(node.args.length);
    this.call = (evaluator, args) => {
      try {
        const scope = new Scope(evaluator.scope);
        for (const i in node.args) {
          const argIdent = node.args[i]
          scope.assign(argIdent.source, args[i]);
        }
        evaluator.block(node.body, scope);
      } catch (e) {
        if (e instanceof ReturnSig) {
          if (node.returnType && typeof e.value == node.returnType.source) return e.value;
          else throw new TaroError(`Function ${node.name} expected to return ${node.returnType.source} but it returned ${typeof e.value}`)
        } else {
          throw e;
        }
      }
    }
  }
}

export class BreakSig extends Error {
  constructor() {
    super("break can only be used inside loops")
  }
}

export class ReturnSig extends Error {
  constructor(value) {
    super("Cannot use return outside a function");
    this.value = value; 
  }
}

export class Value {
  constructor(value, mut) {
    this.value = value;
    this.type = typeof value;
    this.mut = mut;
  }

  set(newValue) {
    if (!this.mut) {
      throw new TaroError("cannot modify a const", line)
    }

    if (this.type !== typeof newValue) {
      throw new TaroError(`type ${this.type} expected, got type ${typeof newValue}`, line)
    }

    this.value = newValue;
  }

  get() {
    return this.value
  }
}
export class Scope {
  constructor(parent = null) {
    this.values = {};
    this.parent = parent
  }

  assign(name, value, mut) {
    if (this.values[name]) {
      this.values[name].set(value);
    } else {
      this.values[name] = new Value(value, mut)
    }
  }

  reassign(name, value) {
    if (this.values[name]) {
      this.values[name].set(value);
    } else if (this.parent) {
      this.parent.reassign(name, value);
    } else {
      throw new Error("Unknown variable " + name)
    }
    return value;
  }

  get(name) {
    if (this.values[name] !== undefined) {
      return this.values[name].get()
    }

    if (this.parent) {
      return this.parent.get(name)
    }
  
    throw new TaroError(`Undefined variable "${name}"`, line)
  }
}

// TODO keep track of the line in some global variable or something
// most lazy solution B)
export class JSEvaluator {
  constructor(ast) {
    this.tree = ast;
    this.scope = new Scope();
    this.scope.assign("io", { out: { writeln: new JsFunc(console.log, 1) } }, false)
  }

  eval() {
    return this.traverse(this.tree)
  }

  block(blockNode, scope) {
    try {
      this.scope = scope;
      for (const statement of blockNode.value) {
        this.traverse(statement);
      }
    } finally {
      this.scope = this.scope.parent;
    }
  }

  traverse(node) {
    line = node.line;
    switch (node.type) {
      case "PROGRAM":
        for (const statement of node.value) {
          this.traverse(statement);
        }
        break;
      case "BLOCK":
        this.block(node, new Scope(this.scope));
        break;
      case "IF":
        const res = this.traverse(node.condition)
        if (res) {
          return this.traverse(node.thenBlock)
        } else {
          return this.traverse(node.elseBlock)
        }
      case "WHILE":
        while(this.traverse(node.condition)) {
          try {
            this.traverse(node.block)
          } catch(e) {
            if (e instanceof BreakSig) {
              break;
            } else {
              throw e;
            }
          }
        }
        break;
      case "BREAK":
        throw new BreakSig()
      case "RETURN":
        throw new ReturnSig(this.traverse(node.value))
      case "LITERAL":
        return node.value;
      case "ASSIGNMENT":
        this.scope.assign(node.name, this.traverse(node.value), node.mut)
        break;
      case "REASSIGN":
        this.scope.reassign(node.name, this.traverse(node.value))
        break;
      case "FUNCTION":
        this.scope.assign(node.name, new TaroFunc(node));
        break;
      case "VAR":
        return this.scope.get(node.value.source)
      case "CALL":
        const func = this.traverse(node.func);
        const traversedArgs = [];
        for (const arg of node.args) {
          traversedArgs.push(this.traverse(arg))
        }
        if (traversedArgs.length != func.arity) {
          throw new TaroError(`Expected ${func.arity} arguments but got ${traversedArgs.length}`, line);
        }
        return this.traverse(node.func).call(this, traversedArgs);
      case "ATTR":
        return this.traverse(node.value)[node.attr.source];
      case "EXPRESSION":
      case "GROUPING":
        return this.traverse(node.value)
      case "BIN_OP":
        const left  = this.traverse(node.left);
        const right = this.traverse(node.right);
        switch (node.op.type) {
          case "BOOL_AND":   return left && right;
          case "BOOL_OR":    return left || right;

          case "EQUALITY":   return left === right;
          case "INEQUALITY": return left !== right;

          case "LT":         return left < right;
          case "GT":         return left > right;
          case "LTE":        return left <= right;
          case "GTE":        return left >= right;

          case "PLUS":       return left + right;
          case "MINUS":      return left - right;
          case "STAR":       return left * right;
          case "SLASH":      return left / right;
          case "MODULO":     return left % right;

          default:           throw new Error("unimplemented op")
        }
      default:
        console.log("unimplemented node " + node.type)
    }
  }
}
