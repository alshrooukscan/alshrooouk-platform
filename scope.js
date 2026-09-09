// Parse the file and report identifiers that are read but never bound.
const fs = require("fs");
const babel = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const src = fs.readFileSync(process.argv[2], "utf8");
const ast = babel.parse(src, { sourceType: "module", plugins: ["jsx"] });
const missing = new Set();
traverse(ast, {
  ReferencedIdentifier(path) {
    const n = path.node.name;
    if (!path.scope.hasBinding(n, true) && !(n in global) &&
        !["window","document","fetch","console","Math","Number","String","JSON","Date","Object","Array","Boolean","navigator","setTimeout","clearTimeout","setInterval","clearInterval","alert","confirm","prompt","URL","Intl","Promise","localStorage","AbortController","FileReader","Blob","crypto","atob","btoa","structuredClone"].includes(n)) {
      missing.add(n + " @line " + path.node.loc.start.line);
    }
  },
});
console.log(missing.size ? [...missing].join("\n") : "no unbound identifiers");
