import b from "binaryen";


export class Emitter {
  constructor(ast) {
    this.tree = ast;
    this.module = new b.Module();
    this.memP = 8;
  } 

  pad(size) {
    this.alloc(this.memP % size)
  }

  alloc(bytes) {
    return ((this.memP += bytes) - bytes)
  }

  emit() {
    this.module.setMemory(1, 64, "memory")
    this.module.addFunctionImport("fd_write", "wasi_unstable", "fd_write", b.createType([ b.i32, b.i32, b.i32, b.i32]), b.i32)
    this.module.addFunction(
      "File_write", 
      b.createType([ b.i32, b.i32 ]), 
      b.none,
      b.none,
      this.module.block(null, [
        this.module.drop(
          this.module.call("fd_write", [ 
            this.module.local.get(0, b.i32),
            this.module.local.get(1, b.i32),
            this.module.i32.const(1),
            this.module.i32.const(0),
          ], b.i32)
        )
      ])
    )
    this.module.addFunctionExport("File_write", "File_write")

    this.traverse(this.tree);
    // this.module.optimize();
    
    const err = this.module.validate();
    if (!err) throw new Error("Validation error: " + err.toString());
    return this.module.emitBinary();
  }

  text() {
    return this.module.emitText();
  }

  u32tou8arr(num) {
    return new Uint8Array([
      num >>  0 & 0xff,
      num >>  8 & 0xff,
      num >> 16 & 0xff,
      num >> 24 & 0xff,
    ])
  }

   escapeu8Bytes
  
  parseType(token) {
    const primatives = {
      void:   b.none,
      i32:    b.i32,
      i64:    b.i64,
      f32:    b.f32,
      f64:    b.f64,
      v128:   b.v128,
      string: b.i32,
    };
    if (primatives[token.source]) {
      return primatives[token.source]
    } else {
      throw new Error("only primatives for now")
    }
  }

  traverse(node) {
    console.log(node)
    switch (node.type) {
      case "PROGRAM":
        for (const statement of node.value) {
          this.traverse(statement);
        }
        break;
      case "BLOCK":
          const children = [];
          for (const statement of node.value) {
            children.push(this.traverse(statement));
          }
          return this.module.block(null, children);
      case "EXPRESSION":
      case "GROUPING":
        return this.traverse(node.value)
      case "FUNCTION": {
        const binaryenArgs = b.createType(node.args.map(({ argType }) => this.parseType(argType)));
        const binaryenReturnArg = node.returnType ? this.parseType(node.returnType) : b.none;
        const func = this.module.addFunction(node.name, binaryenArgs, binaryenReturnArg, [], this.traverse(node.body)); // TODO: function export stuff
        if (node.name === "main") {
          this.module.setStart(func)
        }
        return func;
      }
      case "UNREACHABLE":
        return this.module.unreachable()
      case "LITERAL":
        if (typeof node.value === "string") {
          console.log("CONSTRUCTING STRING: " + node.value)
          const strlen = (new TextEncoder().encode(node.value)).length;
          // bytes for string, 8 bytes for iov
          let str = this.alloc(
            (new TextEncoder().encode(node.value)).length + 4 + 4
          );
          const iov = new Uint32Array(2);
          iov[0] = str + 8;
          iov[1] = strlen;
          const data = new TextEncoder().encode(node.value)

          const combined = new Uint8Array(data.length + iov.length * 4);
          combined.set(this.u32tou8arr(iov[0]), 0)
          combined.set(this.u32tou8arr(iov[1]), 4)
          combined.set(data, 8)

          this.module.setMemory(1, -1, null, [
            {
              offset: this.module.i32.const(str),
              data: combined
            }
          ])

          return this.module.i32.const(str);
        } else if (typeof node.value === "number") {
          return this.module.i32.const(node.value);
        }
        break;
      case "VAR":
        return node.value.source;
      case "CALL":
        const name = this.traverse(node.func);
        const func = { arity: 2 }
        const traversedArgs = [];
        for (const arg of node.args) {
          traversedArgs.push(this.traverse(arg))
        }
        if (traversedArgs.length != func.arity) {
          throw new Error(`Expected ${func.arity} arguments but got ${traversedArgs.length}`);
        }
        return this.module.call(name, traversedArgs, b.none)
      default:
        console.log("Node " + node.type + " not implemented yet");
        return this.module.nop;
    }
  }
}
