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

fn countDigits(num: i32) i32 {
  let count: i32 = 0;
  let numCopy: i32 = num;
  while (numCopy > 0) {
    numCopy = numCopy / 10;
    count = count + 1;
  }
  
  return count;
}

fn printNum(num: i32) void {
  let numCopy: i32 = num;
  let digits: i32 = countDigits(num);
  let literal: string = "TESTDATA";
  while (digits > 0) {
  }
}

fn main() void {
  const stdout: i32 = 1;
  let i: i32 = 1;
  while i < 101 {
    if i % 15 == 0 {
      File:write(stdout, "FizzBuzz\\n");
    } else if i % 3 == 0 {
      File:write(stdout, "Fizz\\n");
    } else if i % 5 == 0 {
      File:write(stdout, "Buzz\\n");
    } else {
      File:write(stdout, ".\\n");
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
