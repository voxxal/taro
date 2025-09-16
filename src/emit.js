import b from "binaryen";

export class Env {
  constructor(parent = null) {
    this.values = {};
    this.parent = parent;
  }

  get(name) {
    if (this.values[name]) {
      return this.values[name];
    } else if (this.parent) {
      return this.parent.get(name);
    }

    throw `Variable ${name} not found`;
  }

  assign(name, type, mut) {
    if (this.values[name]) {
      throw "Shadowing is not implemented yet";
    } else {
      this.values[name] = { name, type, mut };
    }
  }

  assignFn(name, args, result) {
    this.assign(name, [args.map(({ argType }) => argType), result], false);
    this.values[name].arity = args.length;
  }

  reassign(name, type) {
    if (this.values[name]) {
      if (!this.values[name].mut) throw "Cannot reassign to const";
      if (typeFits(this.values[name].type, type))
        throw `Type ${type} does not fit into ${this.values[name].type}`;
    } else if (this.parent) {
      this.parent.reassign(name, value);
    } else {
      throw new Error("Unknown variable " + name);
    }
  }
}

export class Emitter {
  constructor(typedAst, types) {
    this.strMap = {};
    this.tree = typedAst;
    this.module = new b.Module();
    // we leave 8 bytes at the start for fd_write to write the number of bytes to there
    this.memP = 8;
    this.memorySegments = [];
    this.blockEnv = null;
    this.loopLabels = 0;
    this.env = new Env();
    this.types = types;
  }

  align(size) {
    this.alloc(size - (this.memP % size));
  }

  alloc(bytes) {
    return (this.memP += bytes) - bytes;
  }

  emit() {
    // this.module.autoDrop();
    this.module.setMemory(1, 64, "memory");

    this.traverse(this.tree);
    this.module.setMemory(1, -1, null, this.memorySegments);
    // this.module.optimize();
    // console.log(this.module.validate());

    // if (!this.module.validate()) console.log("validation error");
    console.log(this.module.emitText());
    return this.module.emitBinary();
  }

  text() {
    return this.module.emitText();
  }

  u32tou8arr(num) {
    return new Uint8Array([
      (num >> 0) & 0xff,
      (num >> 8) & 0xff,
      (num >> 16) & 0xff,
      (num >> 24) & 0xff,
    ]);
  }

  // type to index
  tti(type) {
    for (const i in this.types) {
      const target = this.types[i];
      if (deepEqual(type, target)) {
        return parseInt(i);
      }
    }

    this.types.push(type);
    return this.types.length - 1;
  }

  // index to type
  itt(i) {
    return this.types[i];
  }

  binaryenType(id) {
    const type = this.itt(id);
    const primitives = {
      void: b.none,
      i32: b.i32,
      i64: b.i64,
      f32: b.f32,
      f64: b.f64,
      v128: b.v128,
      string: b.i32,
      bool: b.i32,
    };

    if (type.type === "primitive" && primitives[type.id] !== undefined) {
      return primitives[type.id];
    } else {
      throw new Error(
        "only primitive for now but type '" +
          JSON.stringify(type) +
          "' provided"
      );
    }
  }

  getTypes(offset, env) {
    const res = [];
    let i = 1;
    for (const name in env.values) {
      const value = env.values[name];
      res.push(this.binaryenType(value.type));
      value.i = offset + i;
      i++;
    }

    return res;
  }

  resolveType(node) {
    // If the valType is non concrete, but we have figured out the actual type,
    // fill in the type
    if (node.valType?.id && node.valType?.actual) {
      node.valType = node.valType.actual;
    } else if (node.valType?.id) {
      throw "Failed to infer type";
    }

    return node.valType;
  }

  traverse(node, parent, ...options) {
    this.resolveType(node);
    switch (node.type) {
      case "PROGRAM":
        for (const statement of node.value) {
          this.traverse(statement);
        }
        break;
      case "EXTERN":
        for (const impor of node.imports) {
          this.traverse(impor, node, node.moduleName);
        }
        break;
      case "EXTERN_FUNCTION":
        this.module.addFunctionImport(
          `${options[0]}:${node.name}`,
          options[0],
          node.name,
          b.createType(
            node.valType.args.map((argType) => this.binaryenType(argType))
          ),
          this.binaryenType(node.valType.ret)
        );
        break;
      case "EXTERN_VAR":
        this.module.addGlobalImport(
          `${options[0]}:${node.name}`,
          options[0],
          node.name,
          this.binaryenType(node.valType)
        );
        break;
      case "BLOCK":
        const children = [];
        try {
          this.env = new Env(this.env);
          if (this.fnArgs) {
            for (const arg of this.fnArgs) {
              this.env.assign(arg.name.source, arg.argType.source, false);
            }

            this.fnArgs = undefined;
          }
          for (const statement of node.value) {
            children.push(this.traverse(statement, node));
          }
        } finally {
          this.blockEnv = this.env;
          this.env = this.env.parent;
        }
        return this.module.block(
          null,
          children,
          this.binaryenType(node.valType)
        );
      case "ASSIGNMENT":
      case "REASSIGN":
        return this.module.local.set(node.localI, this.traverse(node.value));
      case "reassign":
        this.env.reassign(node.name, "i32");
      case "EXPRESSION":
      case "GROUPING":
        return this.traverse(node.value);
      case "FUNCTION": {
        const binaryenArgs = b.createType(
          node.valType.args.map((argType) => this.binaryenType(argType))
        );
        const binaryenReturnArg = node.valType.ret
          ? this.binaryenType(node.valType.ret)
          : b.none;
        const block = this.traverse(node.body);
        const locals = [];
        for (const local of node.locals) {
          locals.push(this.binaryenType(this.resolveType(local)));
        }
        const func = this.module.addFunction(
          node.name,
          binaryenArgs,
          binaryenReturnArg,
          locals,
          block
        ); // TODO: function export stuff
        if (node.name === "main") {
          this.module.setStart(func);
        }
        // this.env.assignFn(node.name, node.args, node.returnType);
        return func;
      }
      case "UNREACHABLE":
        return this.module.unreachable();
      case "LITERAL":
        if (typeof node.value === "string") {
          // if we already have a cached iov use that instead.
          if (this.strMap[node.value])
            return this.module.i32.const(this.strMap[node.value]);
          // iov needs to be aligned to 4 bytes
          this.align(4);

          const strlen = new TextEncoder().encode(node.value).length;
          // bytes for string, 8 bytes for iov
          // .... .... ..?? 
          //  pos  len  str
          let str = this.alloc(strlen + 4 + 4);
          const iov = new Uint32Array(2);
          iov[0] = str + 8;
          iov[1] = strlen;
          const data = new TextEncoder().encode(node.value);

          const combined = new Uint8Array(data.length + iov.length * 4);
          combined.set(this.u32tou8arr(iov[0]), 0);
          combined.set(this.u32tou8arr(iov[1]), 4);
          combined.set(data, 8);
          this.memorySegments.push({
            offset: this.module.i32.const(str),
            data: combined,
          });
          this.strMap[node.value] = str;

          return this.module.i32.const(str);
        } else if (typeof node.value === "number") {
          return this.module.i32.const(node.value);
        }
        break;
      case "VAR":
        return this.module.local.get(
          node.localI,
          this.binaryenType(node.valType)
        );
      case "CALL":
        const traversedArgs = [];
        for (const arg of node.args) {
          traversedArgs.push(this.traverse(arg));
        }
        let call = this.module.call(
          node.func.name,
          traversedArgs,
          this.binaryenType(node.valType)
        );

        if (parent?.type === "BLOCK" && node.valType !== "void") {
          call = this.module.drop(call);
        }

        return call;
      case "RETURN":
        return this.module.return(this.traverse(node.value));

      case "BIN_OP":
        const left = this.traverse(node.left);
        const right = this.traverse(node.right);
        switch (node.op) {
          // TODO do for any type, also _s and _u prefixes
          case "EQUALITY":
            return this.module.i32.eq(left, right);
          case "INEQUALITY":
            return this.module.i32.ne(left, right);
          case "PLUS":
            return this.module.i32.add(left, right);
          case "MINUS":
            return this.module.i32.add(left, right);
          case "SLASH":
            return this.module.i32.div_s(left, right);
          case "MODULO":
            return this.module.i32.rem_s(left, right);

          case "GT":
            return this.module.i32.gt_s(left, right);
          case "LT":
            return this.module.i32.lt_s(left, right);

          case "BOOL_AND":
            return this.module.i32.and(left, right);
          default:
            throw new Error("Unimplemented Bin Op");
        }
      case "IF":
        const cond = this.traverse(node.condition);
        const thenBlock = this.traverse(node.thenBlock);
        const elseBlock = node.elseBlock
          ? this.traverse(node.elseBlock)
          : undefined;
        return this.module.if(cond, thenBlock, elseBlock);

      case "WHILE":
        const label = `while_${this.loopLabels++}`;
        return this.module.loop(
          label,
          this.module.block(null, [
            this.traverse(node.block),
            this.module.br_if(label, this.traverse(node.condition)),
          ])
        );
      default:
        console.log("Emitting node " + node.type + " not implemented yet");
        return this.module.nop;
    }
  }
}
