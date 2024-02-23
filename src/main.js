import { writeFileSync } from "fs";
import { Lexer } from "./lex.js";
import { Parser } from "./parser.js";
import { JSEvaluator } from "./jseval.js";
import { Typechecker } from "./typechecker.js";
import { Emitter } from "./emit.js";

const source = `
extern wasi_unstable {
  fn fd_write(i32, string, i32, i32) i32;
}

fn File:write(fd: i32, str: string) void {
  wasi_unstable:fd_write(fd, str, 1, 0);
}

fn greet(name: string) void {
  File:write(1, "Hello, ");
  File:write(1, name);
  File:write(1, "\\n");
}

fn main() void {
  const stdout: i32 = 1;
  let i: i32 = 1;
  while i < 101 {
    if i % 15 == 0 {
      File:write(1, "FizzBuzz\\n");
    } else if i % 3 == 0 {
      File:write(1, "Fizz\\n");
    } else if i % 5 == 0 {
      File:write(1, "Buzz\\n");
    } else {
      File:write(1, ".\\n");
    }
    i = i + 1;
  }
}
`;
console.log(source);
const tokens = new Lexer(source).scan();
console.log(tokens);
const ast = new Parser(tokens).parse();
console.dir(ast, { depth: null });
const typechecker = new Typechecker(ast)
const typedAst = typechecker.check();
console.dir(typedAst, { depth: null });
// console.dir(check.env, { depth: null })
const emitter = new Emitter(typedAst, typechecker.types);
writeFileSync("main.wasm", emitter.emit());
