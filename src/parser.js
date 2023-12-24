import { TaroError } from "./util.js";

export class Parser {
  constructor(tokens) {
    this.ast = {
      type: "PROGRAM",
      value: [],
    };
    this.tokens = tokens;
    this.curr = 0;
  }

  parse() {
    while (!this.isAtEnd()) {
      this.ast.value.push(this.statement());
    }
    return this.ast;
  }

  parseExtern() {
    const imports = [];
    const moduleName = this.want("IDENT").source;
    this.want("OPEN_BRACE");
    while (!this.match("CLOSE_BRACE")) {
      let token = this.advance();
      switch (token.type) {
        case "FUNCTION":
          {
            const name = this.want("IDENT").source;
            this.want("OPEN_PAREN");
            const args = [];
            if (!this.check("CLOSE_PAREN")) {
              do {
                args.push(this.want("IDENT").source);
              } while (this.match("COMMA"));
            }
            this.want("CLOSE_PAREN");

            const ret = this.want("IDENT").source;
            imports.push({
              type: "EXTERN_FUNCTION",
              name,
              valType: { args, ret },
            });
          }
          break;
        case "CONST": {
          const name = this.want("IDENT").source;
          this.want("COLON");
          const valType = this.want("IDENT").source;
          imports.push({
            type: "EXTERN_VAR",
            name,
            valType,
          });
        }
      }
      this.want("SEMICOLON");
    }
    return {
      type: "EXTERN",
      moduleName,
      imports,
    };
  }

  statement() {
    let token = this.advance();
    switch (token.type) {
      case "LET":
      case "CONST": {
        const name = this.want("IDENT").source;
        let valType = null;
        if (this.match("COLON")) {
          valType = this.want("IDENT").source;
        }
        this.want("ASSIGNMENT");
        const value = this.expression();
        this.want("SEMICOLON");
        return {
          type: "ASSIGNMENT",
          mut: token.type === "LET",
          name,
          value,
          valType,
        };
      }
      case "EXTERN":
        return this.parseExtern();
      case "FUNCTION":
        const name = this.want("IDENT").source;
        this.want("OPEN_PAREN");
        const args = this.fnArgs();
        let returnType = "void";
        if (this.match("IDENT")) {
          returnType = this.previous();
        }
        this.want("OPEN_BRACE");
        const body = this.block();
        return {
          type: "FUNCTION",
          name,
          args,
          returnType,
          body,
        };
      case "OPEN_BRACE":
        return this.block();
      case "WHILE":
        return this.while();
      case "RETURN":
        let value = null;
        if (!this.check("SEMICOLON")) {
          value = this.expression();
        }
        this.want("SEMICOLON");
        return {
          type: "RETURN",
          value,
        };
      case "BREAK":
        return { type: "BREAK" };
      case "UNREACHABLE":
        this.want("SEMICOLON");
        return { type: "UNREACHABLE" };
      case "STRUCT": {
        const name = this.want("IDENT").source;
        this.want("OPEN_BRACE");
        const fields = {};
        let fieldName = null;
        while ((fieldName = this.want("IDENT").source)) {
          this.want("COLON");
          fields[fieldName] = this.want("IDENT").source;
          if (!this.match("COMMA")) break;
          if (!this.check("IDENT")) break;
        }
        this.want("CLOSE_BRACE");
        return {
          type: "STRUCT",
          name,
          value: fields,
        };
      }
      default:
        // TODO bad solution
        this.curr--;
        const expr = this.expression();
        if (expr?.type !== "IF") this.want("SEMICOLON");
        return {
          type: "EXPRESSION",
          value: expr,
        };
    }
  }

  fnArgs() {
    const args = [];
    if (!this.check("CLOSE_PAREN")) {
      do {
        args.push({
          type: "FUNCTION_ARG",
          name: this.want("IDENT"),
          argType: (this.want("COLON"), this.want("IDENT")),
        });
      } while (this.match("COMMA"));
    }
    this.want("CLOSE_PAREN");
    return args;
  }

  block() {
    const statements = [];

    while (!this.check("CLOSE_BRACE") && !this.isAtEnd()) {
      statements.push(this.statement());
    }
    this.want("CLOSE_BRACE");
    return {
      type: "BLOCK",
      value: statements,
    };
  }

  expression() {
    return this.reassign();
  }

  reassign() {
    let expr = this.boolOp();
    if (this.match("ASSIGNMENT")) {
      const value = this.reassign();
      if (expr.type === "VAR") {
        return {
          type: "REASSIGN",
          name: expr.value.source,
          value,
        };
      }
    }
    return expr;
  }

  // TODO: Seperate or and and, and takes precedence v or
  boolOp() {
    let expr = this.equality();
    if (this.match("BOOL_AND", "BOOL_OR")) {
      const op = this.previous();
      const right = this.equality();
      expr = {
        type: "BIN_OP",
        left: expr,
        op,
        right,
      };
    }

    return expr;
  }

  equality() {
    let expr = this.comparison();
    if (this.match("EQUALITY", "INEQUALITY")) {
      const op = this.previous();
      const right = this.comparison();
      expr = {
        type: "BIN_OP",
        left: expr,
        op,
        right,
      };
    }
    return expr;
  }

  comparison() {
    let expr = this.term();

    if (this.match("GT", "GTE", "LT", "LTE")) {
      const op = this.previous();
      const right = this.term();
      expr = {
        type: "BIN_OP",
        left: expr,
        op,
        right,
      };
    }

    return expr;
  }

  term() {
    let expr = this.factor();

    while (this.match("PLUS", "MINUS")) {
      const op = this.previous();
      const right = this.factor();
      expr = {
        type: "BIN_OP",
        left: expr,
        op,
        right,
      };
    }

    return expr;
  }

  factor() {
    let expr = this.unary();

    while (this.match("SLASH", "STAR", "MODULO")) {
      const op = this.previous();
      const right = this.unary();
      expr = {
        type: "BIN_OP",
        left: expr,
        op,
        right,
      };
    }

    return expr;
  }

  unary() {
    if (this.match("NOT", "MINUS")) {
      const op = this.previous();
      const right = this.unary();
      return {
        type: "UNI_OP",
        op,
        right,
      };
    }

    return this.call();
  }

  callArgs() {
    const args = [];
    if (!this.check("CLOSE_PAREN")) {
      do {
        args.push(this.expression());
      } while (this.match("COMMA"));
    }
    this.want("CLOSE_PAREN");
    return args;
  }

  call() {
    const expr = this.attr();
    if (this.match("OPEN_PAREN")) {
      return {
        type: "CALL",
        func: expr,
        args: this.callArgs(),
      };
    }
    return expr;
  }

  attr() {
    const portions = [this.primary()];
    while (this.match("DOT")) {
      portions.push(this.want("IDENT"));
    }
    return this.attrRes(portions);
  }

  attrRes(portions) {
    if (portions.length === 1) return portions[0];
    const attr = portions.pop();
    return {
      type: "ATTR",
      value: this.attrRes(portions),
      attr,
    };
  }

  while() {
    const condition = this.expression();
    this.want("OPEN_BRACE");
    return {
      type: "WHILE",
      condition,
      block: this.block(),
    };
  }

  _if() {
    const condition = this.expression();
    this.want("OPEN_BRACE");
    const thenBlock = this.block();
    let elseBlock = null;
    if (this.match("ELSE")) {
      // Else If block
      if (this.match("IF")) {
        elseBlock = this._if();
      } else {
        this.want("OPEN_BRACE");
        elseBlock = this.block();
      }
    }

    return {
      type: "IF",
      condition,
      thenBlock,
      elseBlock,
    };
  }

  primary() {
    if (this.match("TRUE")) return this.literal(true);
    if (this.match("FALSE")) return this.literal(false);
    if (this.match("STRING", "INTEGER"))
      return this.literal(this.previous().literal);
    if (this.match("POUND")) return this.structLiteral();

    if (this.match("IF")) {
      return this._if();
    }

    if (this.match("IDENT")) {
      return {
        type: "VAR",
        value: this.previous(),
      };
    }
    if (this.match("OPEN_PAREN")) {
      const expr = this.expression();
      this.want("CLOSE_PAREN");
      return {
        type: "GROUPING",
        value: expr,
      };
    }
  }

  structLiteral() {
    // TODO require valType because i am lazy :)
    let valType = null;
    if (this.match("IDENT")) {
      valType = this.previous().source;
    }

    this.want("OPEN_BRACE");
    const fields = {};
    let fieldName = null;
    while ((fieldName = this.want("IDENT").source)) {
      this.want("COLON");
      fields[fieldName] = this.expression();
      if (!this.match("COMMA")) break;
      if (!this.check("IDENT")) break;
    }
    this.want("CLOSE_BRACE");
    return {
      type: "STRUCT_LITERAL",
      value: fields,
      valType,
    };
  }

  literal(value) {
    return {
      type: "LITERAL",
      value,
    };
  }

  peek() {
    return this.tokens[this.curr];
  }

  check(type) {
    return this.peek().type == type;
  }

  previous() {
    return this.tokens[this.curr - 1];
  }

  isAtEnd() {
    return this.peek().type === "EOF";
  }

  advance() {
    return this.tokens[this.curr++];
  }

  want(type) {
    const token = this.tokens[this.curr++];
    if (token.type !== type) {
      throw new TaroError(
        `Expected token type ${type} got ${token.type}`,
        token.line
      );
    }
    return token;
  }

  match(...types) {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }

    return false;
  }
}
