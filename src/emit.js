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
  constructor(typedAst) {
    this.tree = typedAst;
    this.module = new b.Module();
    // we leave 8 bytes at the start for fd_write to write the number of bytes to there
    this.memP = 8;
    this.memorySegments = [];
    this.blockEnv = null;
    this.env = new Env();
  }

  align(size) {
    this.alloc(size - (this.memP % size));
  }

  alloc(bytes) {
    return (this.memP += bytes) - bytes;
  }

  emit() {
    this.module.setMemory(1, 64, "memory");
    this.env.assignFn(
      "File_write",
      [{ argType: "i32" }, { argType: "i32" }],
      "void"
    );

    this.traverse(this.tree);
    this.module.setMemory(1, -1, null, this.memorySegments);
    // this.module.optimize();
    // console.log(this.module.validate());

    if (!this.module.validate()) console.log("validation error");
    return this.module.emitText();
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

  binaryenType(name) {
    const primatives = {
      void: b.none,
      i32: b.i32,
      i64: b.i64,
      f32: b.f32,
      f64: b.f64,
      v128: b.v128,
      string: b.i32,
    };

    if (primatives[name] !== undefined) {
      return primatives[name];
    } else {
      throw new Error(
        "only primatives for now but type '" + name + "' provided"
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
    }

    return node.valType;
  }

  traverse(node, ...options) {
    this.resolveType(node);
    switch (node.type) {
      case "PROGRAM":
        for (const statement of node.value) {
          this.traverse(statement);
        }
        break;
      case "EXTERN":
        for (const impor of node.imports) {
          this.traverse(impor, node.moduleName);
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
            children.push(this.traverse(statement));
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
          // iov needs to be aligned to 4 bytes
          this.align(4);

          const strlen = new TextEncoder().encode(node.value).length;
          // bytes for string, 8 bytes for iov
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
        
        // TODO drop keyword
        if (node.func.name === "wasi_unstable:fd_write") {
          return this.module.drop(
            this.module.call(
              node.func.name,
              traversedArgs,
              this.binaryenType(node.valType)
            )
          );
        }

        return this.module.call(
          node.func.name,
          traversedArgs,
          this.binaryenType(node.valType)
        );
      case "RETURN":
        return this.module.return(this.traverse(node.value));
      default:
        console.log("Node " + node.type + " not implemented yet");
        return this.module.nop;
    }
  }
}
