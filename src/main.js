import { writeFileSync } from "fs"
import { Lexer } from "./lex.js"
import { Parser } from "./parser.js"
import { JSEvaluator } from "./jseval.js"
import { Emitter } from "./emit.js"

const source = `
fn main() {
  File_write(1, "Hello World");
}
`
console.log(source)
const tokens = new Lexer(source).scan();
console.log(tokens)
const ast = new Parser(tokens).parse();
console.dir(ast, { depth: null })
const emission = new Emitter(ast);
writeFileSync("./main.wasm", emission.emit());
console.log(emission.text());
