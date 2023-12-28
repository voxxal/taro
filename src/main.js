import { writeFileSync } from "fs"
import { Lexer } from "./lex.js"
import { Parser } from "./parser.js"
import { JSEvaluator } from "./jseval.js"
import { Typechecker } from "./typechecker.js"
import { Emitter } from "./emit.js"

// struct File {
//   fd: i32,
// }
// fn greet(name: string) void {
// }


const source = `
extern wasi_unstable {
  fn fd_write(i32, string, i32, i32) i32;
  fn fd_read(i32, i32, i32, i32) i32;
}

fn File:write(fd: i32, str: string) void {
  wasi_unstable:fd_write(fd, str, 1, 0);
}

fn greet(name: string) void {
  File:write(1, "Hello, ");
  File:write(1, name);
}
fn main() void {
  const name = "World";
  greet(name);
}
`;
console.log(source)
const tokens = new Lexer(source).scan();
console.log(tokens)
const ast = new Parser(tokens).parse();
console.dir(ast, { depth: null })
const typedAst = new Typechecker(ast).check();
console.dir(typedAst, { depth: null });
// console.dir(check.env, { depth: null })
const emitter = new Emitter(typedAst);
console.log(emitter.emit());