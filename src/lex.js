import { TaroError } from "./util.js"
const KEYWORDS = {
  let: "LET",
  const: "CONST",
  fn: "FUNCTION",
  struct: "STRUCT",
  for: "FOR",
  while: "WHILE",
  if: "IF",
  else: "ELSE",
  in: "IN",
  true: "TRUE",
  false: "FALSE",
  break: "BREAK",
  return: "RETURN",
  unreachable: "UNREACHABLE",
  extern: "EXTERN",
};

export class Lexer {
  constructor(source) {
    this.source = source;
    this.tokens = [];
    this.line = 1;
    this.start = 0;
    this.current = 0;
  }

  scan() {
    while (!this.isAtEnd()) {
      this.start = this.current;

      this.scanToken();
    }
    this.tokens.push({ type: "EOF", source: "", line: this.line });
    return this.tokens;
  }

  scanToken() {
    const c = this.advance();
    switch (c) {
      case "(": this.pushToken("OPEN_PAREN"); break;
      case ")": this.pushToken("CLOSE_PAREN"); break;
      case "{": this.pushToken("OPEN_BRACE"); break;
      case "}": this.pushToken("CLOSE_BRACE"); break;
      case ".": this.pushToken("DOT"); break;
      case ",": this.pushToken("COMMA"); break;
      case "#": this.pushToken("POUND"); break;

      case "+": this.pushToken(this.match("=") ? "PLUS_ASSIGN" : "PLUS"); break;
      case "-": this.pushToken(this.match("=") ? "MINUS_ASSIGN" : "MINUS"); break;
      case "*": this.pushToken(this.match("=") ? "STAR_ASSIGN" : "STAR"); break;
      case "/": this.pushToken(this.match("=") ? "SLASH_ASSIGN" : "SLASH"); break;
      case "%": this.pushToken("MODULO"); break;

      case ":": this.pushToken("COLON"); break;
      case ";": this.pushToken("SEMICOLON"); break;

      case "!": this.pushToken(this.match("=") ? "INEQUALITY" : "NOT"); break;
      case ">": this.pushToken(this.match("=") ? "GTE" : "GT"); break;
      case "<": this.pushToken(this.match("=") ? "LTE" : "LT"); break;
      case "=": this.pushToken(this.match("=") ? "EQUALITY" : "ASSIGNMENT"); break;
      case "&": this.pushToken(this.match("&") ? "BOOL_AND" : "BIN_AND"); break;
      case "|": this.pushToken(this.match("|") ? "BOOL_OR" : "BIN_OR"); break;

      case " ":
      case "\r":
      case "\t":
        break;

      case "\n":
        this.line++;
        break;
      
      case '"':
        while (this.peek() != '"' && !this.isAtEnd()) {
          if (this.peek() == "\n")
            throw new TaroError("Multiline String literals not allowed", this.line);
          this.advance();
        }

        if (this.isAtEnd()) throw new TaroError("Unterminated String", this.line);
        this.advance()
        this.pushToken(
          "STRING",
          this.source.substring(this.start + 1, this.current - 1)
        );
        break;

      default:
        if (this.isDigit(c)) {
          while (this.isDigit(this.peek())) this.advance();
          this.pushToken(
            "INTEGER",
            parseInt(this.source.substring(this.start, this.current))
          );
        } else if (this.isLegalIdentChar(c)) {
          while (this.isLegalIdentChar(this.peek())) this.advance();
          if (this.source.charAt(this.current - 1) == ":") this.current -= 1;
          const name = this.source.substring(this.start, this.current);
          const type = KEYWORDS[name] || "IDENT";
          this.pushToken(type);
        } else {
          throw new TaroError("Unexpected character", this.line)
        }
        break;
    }
  }

  pushToken(type, literal = undefined) {
    this.tokens.push({
      type,
      source: this.source.substring(this.start, this.current),
      literal,
      line: this.line,
    });
  }

  peek() {
    if (this.isAtEnd()) return "";
    return this.source.charAt(this.current);
  }

  isAtEnd() {
    return this.current >= this.source.length;
  }

  advance() {
    return this.source.charAt(this.current++);
  }

  isDigit(c) {
    return c >= "0" && c <= "9";
  }

  isLegalIdentChar(c) {
    return (c >= "a" && c <= "z") 
      || (c >= "A" && c <= "Z") 
      || (c >= "0" && c <= "9") 
      || c == "_" || c == ":";
  }

  match(expected) {
    if (this.peek() != expected) return false;
    this.advance();
    return true;
  }
}

