const numberTypes = ["i32", "i64", "u32", "u64", "f32", "f64"];

const typeFits = (to, from) => {
  if (to === "any" || from === "any") return true;

  return to === from;
};

export class Env {
  constructor(parent = null) {
    this.values = {};
    this.types = {};
    this.parent = parent;
  }

  get(name) {
    if (this.values[name]) {
      return this.values[name];
    } else if (this.parent) {
      return this.parent.get(name);
    }

    throw new Error(`Variable ${name} not found`);
  }

  getType(name) {
    if (this.types[name]) {
      return this.types[name].type;
    } else if (this.parent) {
      return this.parent.getType(name);
    }

    throw `Type ${name} not found`;
  }

  assignType(name, type) {
    if (this.values[name]) {
      throw "Type " + name + "cannot be reassigned";
    } else {
      this.types[name] = { name, type };
    }
  }

  assign(name, type, mut, localI) {
    if (this.values[name]) {
      throw "Shadowing is not implemented yet";
    } else {
      this.values[name] = { name, type, mut, localI };
    }
  }

  assignFn(name, valType) {
    this.assign(name, valType, false);
    this.values[name].arity = valType.args.length;
  }

  reassign(name, type) {
    const prev = this.values[name];
    if (prev) {
      if (!prev.mut) throw "Cannot reassign to const";
      if (!typeFits(prev.type, type))
        throw `Type ${type} does not fit into ${this.values[name].type}`;
    } else if (this.parent) {
      this.parent.reassign(name, type);
    } else {
      throw new Error("Unknown variable " + name);
    }
  }
}

export class Typechecker {
  constructor(ast) {
    this.tree = ast;
    this.env = new Env();
    this.unknownCount = 0;
  }

  check() {
    return this.traverse(this.tree);
  }

  typeLiteral(literal) {
    // currently we only care about numbers
    // and strings
    //
    // With numbers we need to infer a number
    // so we return number here.
    let valType = null;
    switch (typeof literal) {
      case "number":
        valType = { id: "number_" + this.unknownCount++ };
        break;
      case "string":
        valType = "string";
        break;
      case "boolean":
        valType = "bool";
        break;
      default:
        throw "okay.";
    }

    return {
      type: "LITERAL",
      value: literal,
      valType,
    };
  }

  resolveType(node) {
    // If the valType is non concrete, but we have figured out the actual type,
    // fill in the type
    if (node.valType?.id && node.valType?.actual) {
      node.valType = node.valType.actual;
    }

    return node.valType;
  }

  isNonConcreteType(node) {
    this.resolveType(node);
    return !!node.valType?.id;
  }

  isNonConcreteNumberType(node) {
    this.resolveType(node);
    return !!node.valType?.id?.startsWith("number_");
  }

  isNumberType(node) {
    return (
      this.isNonConcreteNumberType(node) || numberTypes.includes(node.valType)
    );
  }

  coerceNonConcreteType(from, to) {
    if (this.isNonConcreteNumberType(from) || this.isNonConcreteNumberType(to))
      return this.coerceNumberType(from, to);
    if (!this.isNonConcreteType(from)) return;
    this.resolveType(to);
    if (!this.isNonConcreteType(to)) {
      from.valType.actual = to.valType;
    }
  }

  coerceNumberType(from, to) {
    if (!this.isNonConcreteNumberType(from))
      throw "coerce number type called on a non non concrete number";
    if (!this.isNumberType(to))
      throw "target type of coerceNumberType was not a number type";
    if (this.isNonConcreteNumberType(to)) {
      // if to is an infered type, set it to the infered type
      from.valType.actual = to.valType;
      this.resolveType(from);
    } else if (numberTypes.includes(to.valType)) {
      // else if to is already concrete then you need to set
      from.valType.actual = to.valType;
      this.resolveType(from);
    }
  }

  typeBinOp(op, left, right) {
    if (this.isNonConcreteType(right)) {
      this.coerceNonConcreteType(right, left);
    } else if (this.isNonConcreteType(left)) {
      this.coerceNonConcreteType(left, right);
    }

    if (left.valType != right.valType)
      throw `mismatched types on bin_op ${op}. left: ${JSON.stringify(
        left.valType
      )}, right: ${JSON.stringify(right.valType)}`;
    switch (op) {
      // bool -> bool -> bool
      case "BOOL_AND":
      case "BOOL_OR":
        if (left.valType !== "bool" || right.valType !== "bool")
          throw "expected left and right of boolean operation to be bool";
      // x -> x -> bool
      case "EQUALITY":
      case "INEQUALITY":
      case "LT":
      case "GT":
      case "LTE":
      case "GTE":
        return {
          type: "BIN_OP",
          left,
          right,
          op,
          valType: "bool",
        };
      // x -> x -> x
      case "PLUS":
      case "MINUS":
      case "STAR":
      case "SLASH":
      case "MODULO":
        return {
          type: "BIN_OP",
          left,
          right,
          op,
          valType: left.valType,
        };
    }
  }

  checkStructLiteral(node) {
    const type = this.env.getType(node.valType);
    for (const [key, fieldType] of Object.entries(type)) {
      if (!node.value[key]) throw "missing field " + key + " on struct literal";
      if (this.isNonConcreteNumberType(node.value[key]))
        this.coerceNonConcreteType(node.value[key], { valType: fieldType });
      if (node.value[key].valType != fieldType)
        throw "mismatched type on struct literal";
    }
  }

  // TODO we need one general function that will try to match 2 types, cocrce if it must, and error otherwise
  traverse(node, ...options) {
    switch (node.type) {
      case "PROGRAM":
        const progValue = [];
        for (const statement of node.value) {
          progValue.push(this.traverse(statement));
        }
        return {
          type: "PROGRAM",
          value: progValue,
        };
      case "EXTERN":
        for (const impor of node.imports) {
          this.traverse(impor, node.moduleName);
        }
        return node;
      case "EXTERN_FUNCTION":
        this.env.assignFn(`${options[0]}:${node.name}`, node.valType);
        return node;
      case "EXTERN_VAR":
        this.env.assign(`${options[0]}:${node.name}`, node.valType, false);
        return node;
      case "FUNCTION": {
        this.scopeI = 0;
        this.functionLocals = [];
        this.functionArgs = [];
        this.argsLength = node.args.length;

        const fnArgs = [];
        const valType = { args: [], ret: null };
        for (const arg of node.args) {
          const travArg = this.traverse(arg);
          fnArgs.push({ name: travArg.name, valType: travArg.valType });
          valType.args.push(travArg.valType);
        }

        this.functionArgs = fnArgs;

        const body = this.traverse(node.body, fnArgs);
        if (this.isNonConcreteType(body))
          this.coerceNonConcreteType(body, { valType: node.returnType.source });
        if (this.resolveType(body) !== node.returnType.source) {
          throw `Expected function to return ${JSON.stringify(
            node.returnType.source
          )} but it returned ${JSON.stringify(body.valType)}`;
        }

        valType.ret = body.valType;

        this.env.assignFn(node.name, valType);
        return {
          type: "FUNCTION",
          name: node.name,
          args: fnArgs,
          valType,
          locals: this.functionLocals,
          body,
        };
      }
      case "FUNCTION_ARG":
        return {
          type: "FUNCTION_ARG",
          name: node.name.source,
          valType: node.argType.source,
        };
      case "RETURN":
        return {
          type: "RETURN",
          value: this.traverse(node.value),
        };
      // TODO for each block compile a list
      // env is perfect for this figure out how to use that in order to get this to work.
      // of all locals needed so we can reuse certain
      // locals for each scope
      case "BLOCK":
        this.scopeI += 1;
        const value = [];
        let valType = "void";
        try {
          this.env = new Env(this.env);
          if (Array.isArray(options[0])) {
            for (const arg of options[0]) {
              this.env.assign(arg.name, arg.valType, false);
            }
          }
          for (const statement of node.value) {
            const res = this.traverse(statement);
            if (res.type === "RETURN") {
              valType = this.resolveType(res.value);
            }
            value.push(res);
          }
        } finally {
          this.env = this.env.parent;
        }
        return {
          type: "BLOCK",
          value,
          valType,
        };
      case "ASSIGNMENT": {
        const value = this.traverse(node.value);
        const valType = node.valType ??
          this.resolveType(value) ?? { id: "unknown_" + this.unknownCount++ };
        // TODO create a seperate function when a type is infered so we can typecheck the struct
        if (this.isNonConcreteType(value) && !this.isNonConcreteType(valType)) {
          value.valType = valType;
        }

        const localI = this.functionLocals.length + this.argsLength;
        this.env.assign(node.name, valType, node.mut, localI);
        this.functionLocals.push({
          name: node.name,
          valType,
          scopeI: this.scopeI,
        });
        return {
          ...node,
          value,
          valType,
          localI,
        };
      }
      case "REASSIGN": {
        const value = this.traverse(node.value);
        const prev = this.env.get(node.name);
        this.env.reassign(node.name, value.valType);
        return {
          ...node,
          value,
          localI: prev.localI,
        };
      }
      case "STRUCT":
        this.env.assignType(node.name, node.value);
        return {
          ...node,
        };
      case "VAR":
        const localI = this.functionArgs
          .concat(this.functionLocals)
          .findIndex(
            (local) =>
              local.name === node.value.source &&
              (local.scopeI && local.scopeI != 1
                ? this.scopeI == local.scopeI
                : true)
          );

        return {
          type: "VAR",
          name: node.value.source,
          valType: this.env.get(node.value.source).type,
          localI,
        };
      case "ATTR": {
        const value = this.traverse(node.value);
        const attr = node.attr.source;
        let valType = null;

        switch (value.type) {
          case "VAR":
            const structType = this.env.getType(value.valType);
            valType = structType[attr];
            break;
        }

        return {
          type: "ATTR",
          value,
          attr: node.attr.source,
          valType,
        };
      }
      case "CALL":
        const func = this.traverse(node.func);
        const { args, ret } = func.valType;
        const actualArgs = [];
        for (const arg of node.args) {
          actualArgs.push(this.traverse(arg));
        }
        if (actualArgs.length !== func.valType.args.length) {
          throw `Expected ${func.valType.args.length} arguments but only got ${node.args.length}`;
        }

        for (const i in actualArgs) {
          const actual = actualArgs[i];
          const expected = args[i];
          if (this.isNonConcreteType(actual))
            this.coerceNonConcreteType(actual, { valType: expected });
          if (this.resolveType(actual) !== expected) {
            throw `mismatched types: expected ${expected}, got type ${actual.valType}`;
          }
        }

        return {
          type: "CALL",
          func,
          args: actualArgs,
          valType: ret,
        };
      case "IF":
        const thenBlock = this.traverse(node.thenBlock);
        const elseBlock = node.elseBlock ? this.traverse(node.elseBlock) : null;
        if (elseBlock) {
          if (this.isNonConcreteType(elseBlock)) {
            this.coerceNonConcreteType(elseBlock, thenBlock);
          } else if (this.isNonConcreteType(thenBlock)) {
            this.coerceNonConcreteType(thenBlock, elseBlock);
          }
          if (this.resolveType(thenBlock) !== this.resolveType(elseBlock)) {
            throw `mismatched types in if statement. then: ${JSON.stringify(
              thenBlock.valType
            )}, else: ${JSON.stringify(elseBlock.valType)}`;
          }
        }

        const condition = this.traverse(node.condition);
        if (condition.valType !== "bool")
          throw new Error("Condition is not boolean");

        return {
          type: "IF",
          condition,
          thenBlock,
          elseBlock,
          valType: thenBlock.valType,
        };
      case "EXPRESSION":
      case "GROUPING":
        return this.traverse(node.value);
      case "LITERAL":
        return this.typeLiteral(node.value);
      case "STRUCT_LITERAL": {
        const valType = this.resolveType(node) ?? {
          id: "unknown_" + this.unknownCount++,
        };
        const fields = {};
        for (const [key, field] of Object.entries(node.value)) {
          fields[key] = this.traverse(field);
        }
        const newNode = {
          ...node,
          valType,
          value: fields,
        };
        if (!this.isNonConcreteType({ valType }))
          this.checkStructLiteral(newNode);
        return newNode;
      }
      case "BIN_OP":
        const left = this.traverse(node.left);
        const right = this.traverse(node.right);
        return this.typeBinOp(node.op.type, left, right);
      case "WHILE": {
        const condition = this.traverse(node.condition);
        if (condition.valType !== "bool")
          throw new Error("Condition is not boolean");
        const block = this.traverse(node.block);
        return {
          type: "WHILE",
          condition,
          block,
        };
      }
      default:
        throw "Node not implemented";
    }
  }
}
