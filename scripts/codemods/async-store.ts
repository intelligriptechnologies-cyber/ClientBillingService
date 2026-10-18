// Usage: node scripts/codemods/async-store.ts [--check | --races <base-commit> | --contract-only]
//   (no flag)  regenerate the TenantStore contract in src/lib/store/types.ts, then await every store call in src/ to a fixpoint
//   --check    list store calls that are neither awaited nor returned; exit 1 if any
//   --contract-only  regenerate the contract and nothing else
//   --races    list store reads followed by a store write with an await between them that the base commit did not have
import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { Node, Project, QuoteKind, SyntaxKind, TypeFormatFlags, type CallExpression, type SourceFile } from 'ts-morph';

const root = resolve(import.meta.dirname, '..', '..');
const srcDir = resolve(root, 'src').replaceAll('\\', '/');
const typesPath = resolve(root, 'src/lib/store/types.ts');
const factoryPath = resolve(root, 'src/lib/store/create-store.ts');
const mode = ['--check', '--races', '--contract-only'].find((flag) => process.argv.includes(flag)) ?? 'apply';

const project = new Project({ tsConfigFilePath: resolve(root, 'tsconfig.json'), manipulationSettings: { quoteKind: QuoteKind.Single } });
const sourceFiles = () => project.getSourceFiles().filter((file) => file.getFilePath().startsWith(`${srcDir}/`));
const where = (node: Node) => `${relative(root, node.getSourceFile().getFilePath()).replaceAll('\\', '/')}:${node.getStartLineNumber()}`;

type FunctionNode = Node & { isAsync?: () => boolean };
const testHooks = new Set(['it', 'test', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll']);
const promiseCombinators = /^Promise\.(all|allSettled|race|any)$/;
const mutator = /^(create|update|record|settle|renew|void|correct|close[A-Z]|delete|generate|set|log)/;

/** Follows `const { helper } = await setup()` and `return { helper }` back to the function that defines `helper`. */
function resolveDeclaration(declaration: Node, depth = 0): Node[] {
  if (depth > 5) return [declaration];
  if (Node.isBindingElement(declaration)) {
    const pattern = declaration.getParentOrThrow();
    const name = declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
    let type = pattern.getType();
    if (type.getSymbol()?.getName() === 'Promise') type = type.getTypeArguments()[0] ?? type;
    return (type.getProperty(name)?.getDeclarations() ?? [declaration]).flatMap((next) => resolveDeclaration(next, depth + 1));
  }
  if (Node.isShorthandPropertyAssignment(declaration)) {
    const value = project.getTypeChecker().getShorthandAssignmentValueSymbol(declaration);
    return (value?.getDeclarations() ?? [declaration]).flatMap((next) => next === declaration ? [declaration] : resolveDeclaration(next, depth + 1));
  }
  return [declaration];
}

function calleeDeclarations(call: CallExpression): Node[] {
  let symbol = call.getExpression().getSymbol();
  if (symbol?.isAlias()) symbol = symbol.getAliasedSymbol();
  return (symbol?.getDeclarations() ?? []).flatMap((declaration) => resolveDeclaration(declaration));
}

function isStoreMember(declaration: Node) {
  const owner = declaration.getParent();
  return Node.isMethodSignature(declaration) && Node.isInterfaceDeclaration(owner) && owner.getName() === 'TenantStore';
}

const isStoreCall = (call: CallExpression) => calleeDeclarations(call).some(isStoreMember);
const storeMethodName = (call: CallExpression) => calleeDeclarations(call).find(isStoreMember)?.getSymbol()?.getName() ?? '';

function unwrapParens(node: Node) {
  let current = node;
  while (Node.isParenthesizedExpression(current.getParent())) current = current.getParentOrThrow();
  return current;
}

function enclosingFunction(node: Node): FunctionNode | undefined {
  return node.getFirstAncestor((ancestor) => Node.isFunctionLikeDeclaration(ancestor)) as FunctionNode | undefined;
}

function insideTryWithCatch(node: Node) {
  for (let child = node, parent = node.getParent(); parent && !Node.isFunctionLikeDeclaration(parent); child = parent, parent = parent.getParent()) {
    if (Node.isTryStatement(parent) && parent.getTryBlock() === child && parent.getCatchClause()) return true;
  }
  return false;
}

function isCombinatorArgument(node: Node) {
  const parent = node.getParent();
  return Node.isCallExpression(parent) && promiseCombinators.test(parent.getExpression().getText()) && parent.getArguments()[0] === node;
}

/** The named declaration that callers resolve to, for a function that is not an inline argument. */
function holderOf(fn: Node): Node | undefined {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) return fn;
  const parent = fn.getParent();
  if ((Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) && (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent))) return parent;
  return undefined;
}

function keyOf(declaration: Node) {
  const names = [declaration, ...declaration.getAncestors()]
    .filter((node) => Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) || Node.isVariableDeclaration(node) || Node.isPropertyAssignment(node) || Node.isClassDeclaration(node))
    .map((node) => (node as Node & { getName(): string | undefined }).getName() ?? '?')
    .reverse();
  return `${declaration.getSourceFile().getFilePath()}::${names.join('.')}`;
}


function writeContract() {
  const typesFile = project.getSourceFileOrThrow(typesPath);
  const literal = project.getSourceFileOrThrow(factoryPath).getFunctionOrThrow('createSqliteMethods').getFirstDescendantByKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const methods = literal.getProperties().flatMap((member) => Node.isSpreadAssignment(member)
    ? member.getExpression().getType().getProperties().map((property) => property.getDeclarations()[0])
    : [member]);
  const imports = new Map<string, Set<string>>();
  const typeText = (node: Node | undefined, fallback: () => string) => {
    if (!node) return fallback();
    for (const reference of [node, ...node.getDescendants()].filter(Node.isTypeReference)) {
      const name = reference.getTypeName().getText();
      let symbol = reference.getTypeName().getSymbol();
      if (symbol?.isAlias()) symbol = symbol.getAliasedSymbol();
      const declarationFile = symbol?.getDeclarations()[0]?.getSourceFile();
      if (!declarationFile || declarationFile === typesFile || declarationFile.isInNodeModules() || declarationFile.isDeclarationFile()) continue;
      const specifier = typesFile.getRelativePathAsModuleSpecifierTo(declarationFile);
      imports.set(specifier, (imports.get(specifier) ?? new Set()).add(name));
    }
    return node.getText();
  };
  const inferred = (node: Node, type = node.getType()) => {
    const symbol = type.getAliasSymbol() ?? type.getSymbol();
    const declaration = symbol?.getDeclarations()[0];
    if (declaration && (Node.isTypeAliasDeclaration(declaration) || Node.isInterfaceDeclaration(declaration)) && !declaration.getSourceFile().isInNodeModules()) {
      if (declaration.getSourceFile() !== typesFile) {
        const specifier = typesFile.getRelativePathAsModuleSpecifierTo(declaration.getSourceFile());
        imports.set(specifier, (imports.get(specifier) ?? new Set()).add(declaration.getName()));
      }
      return declaration.getName();
    }
    return type.getText(typesFile, TypeFormatFlags.UseAliasDefinedOutsideCurrentScope | TypeFormatFlags.NoTruncation);
  };
  const lines = methods.map((method) => {
    if (!Node.isMethodDeclaration(method)) throw new Error(`${where(method)} is not a method declaration`);
    const docs = method.getJsDocs().map((doc) => `  ${doc.getText()}\n`).join('');
    const parameters = method.getParameters().map((parameter) => `${parameter.getName()}${parameter.hasInitializer() || parameter.hasQuestionToken() ? '?' : ''}: ${typeText(parameter.getTypeNode(), () => inferred(parameter))}`);
    const returns = typeText(method.getReturnTypeNode(), () => inferred(method, method.getReturnType()));
    return `${docs}  ${method.getName()}(${parameters.join(', ')}): Promise<${returns}>;`;
  });
  for (const [specifier, names] of imports) {
    const existing = typesFile.getImportDeclaration((declaration) => declaration.getModuleSpecifierValue() === specifier);
    const missing = [...names].filter((name) => !existing?.getNamedImports().some((named) => named.getName() === name));
    if (!missing.length) continue;
    if (existing) existing.addNamedImports(missing);
    else typesFile.addImportDeclaration({ isTypeOnly: true, moduleSpecifier: specifier, namedImports: missing });
  }
  const contract = `/** The store contract. The SQLite store wraps synchronous bodies, so each call settles after its whole body has run. */\nexport interface TenantStore {\n${lines.join('\n')}\n}`;
  const current = typesFile.getInterface('TenantStore');
  if (current) {
    if (current.getFullText().trim() !== contract) current.replaceWithText(contract);
  } else typesFile.addStatements(`\n${contract}`);
}


type Edit = { start: number; end: number; text: string; order: number };

function sweep() {
  const asyncHolders = new Set<string>();
  const reports = new Set<string>();
  for (let pass = 1; pass <= 12; pass += 1) {
    const edits = new Map<SourceFile, Edit[]>();
    const seenFunctions = new Set<Node>();
    // Insertions at one position read left to right as: closers of inner nodes, closers of outer nodes, openers of outer nodes, openers of inner nodes.
    const edit = (node: Node, start: number, end: number, text: string, side: 'open' | 'close' = 'open') => {
      const list = edits.get(node.getSourceFile()) ?? [];
      const order = side === 'close' ? node.getWidth() : 2 ** 30 - node.getWidth();
      if (!list.some((item) => item.start === start && item.end === end && item.text === text)) list.push({ start, end, text, order });
      edits.set(node.getSourceFile(), list);
    };
    const report = (node: Node, message: string) => reports.add(`${where(node)}  ${message}`);

    const isAsyncCall = (call: CallExpression) => calleeDeclarations(call).some((declaration) => isStoreMember(declaration) || asyncHolders.has(keyOf(declaration)));

    const needsParens = (node: Node) => {
      const parent = node.getParent();
      return (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent) || Node.isCallExpression(parent) || Node.isTaggedTemplateExpression(parent)) && parent.getExpression() === node
        || Node.isNonNullExpression(parent);
    };

    /** `node` evaluates to a promise. Await it in place unless it already flows out as a return value. */
    const consume = (node: Node, prefix = '', suffix = '') => {
      const target = unwrapParens(node);
      const parent = target.getParent();
      const wrap = (before: string, after: string) => {
        if (before || prefix) edit(node, node.getStart(), node.getStart(), `${before}${prefix}`);
        if (after || suffix) edit(node, node.getEnd(), node.getEnd(), `${suffix}${after}`, 'close');
      };
      if (Node.isAwaitExpression(parent) || isCombinatorArgument(target)) return wrap('', '');
      if (Node.isArrayLiteralExpression(parent) && isCombinatorArgument(parent)) return wrap('', '');
      if (Node.isReturnStatement(parent)) {
        wrap(insideTryWithCatch(target) ? 'await ' : '', '');
        return markAsync(enclosingFunction(target), target);
      }
      if (Node.isArrowFunction(parent) && parent.getBody() === target) {
        wrap('', '');
        return markAsync(parent, target);
      }
      if (needsParens(target)) wrap('(await ', ')');
      else wrap('await ', '');
      markAsync(enclosingFunction(target), target);
    };

    const addAsyncKeyword = (fn: FunctionNode) => {
      if (fn.isAsync?.()) return;
      if (Node.isFunctionDeclaration(fn) || Node.isFunctionExpression(fn)) edit(fn, fn.getFirstChildByKindOrThrow(SyntaxKind.FunctionKeyword).getStart(), fn.getFirstChildByKindOrThrow(SyntaxKind.FunctionKeyword).getStart(), 'async ');
      else if (Node.isMethodDeclaration(fn)) edit(fn, fn.getNameNode().getStart(), fn.getNameNode().getStart(), 'async ');
      else if (Node.isArrowFunction(fn)) edit(fn, fn.getStart(), fn.getStart(), 'async ');
      else return report(fn, `cannot be async (${fn.getKindName()}); fix by hand`);
      const returnType = Node.isFunctionLikeDeclaration(fn) ? fn.getReturnTypeNode() : undefined;
      if (returnType && !/^Promise</.test(returnType.getText())) {
        if (Node.isTypePredicate(returnType)) report(fn, 'type predicate cannot become async; fix by hand');
        else edit(fn, returnType.getStart(), returnType.getEnd(), `Promise<${returnType.getText()}>`);
      }
      if (fn.getSourceFile().getStatements()[0]?.getText().match(/^['"]use client['"]/)) report(fn, 'client component code now awaits the store; fix by hand');
    };

    /** `fn` now produces a promise. Make it async and decide, from where it sits, who consumes that promise. */
    const markAsync = (fn: FunctionNode | undefined, cause: Node) => {
      if (!fn) return report(cause, 'store call at module scope; fix by hand');
      if (seenFunctions.has(fn)) return;
      seenFunctions.add(fn);
      const holder = holderOf(fn);
      if (holder) {
        addAsyncKeyword(fn);
        if (!fn.isAsync?.()) asyncHolders.add(keyOf(holder));
        return;
      }
      const call = fn.getParent();
      if (!Node.isCallExpression(call) || !call.getArguments().includes(fn)) {
        if (fn.isAsync?.()) return;
        return report(fn, `${fn.getKindName()} in ${call?.getKindName()} now awaits the store; fix by hand`);
      }
      const callee = call.getExpression();
      const calleeName = Node.isPropertyAccessExpression(callee) ? callee.getName() : callee.getText();
      if (calleeName === 'expect') return rejectsInsteadOfThrow(fn, call, cause);
      if (testHooks.has(calleeName.split('.')[0]) || testHooks.has(Node.isPropertyAccessExpression(callee) ? callee.getExpression().getText() : '')) return addAsyncKeyword(fn);
      if (calleeName === 'map' && Node.isPropertyAccessExpression(callee)) {
        addAsyncKeyword(fn);
        if (isCombinatorArgument(unwrapParens(call))) return;
        return consume(call, 'Promise.all(', ')');
      }
      if (calleeName === 'forEach' && Node.isPropertyAccessExpression(callee) && Node.isExpressionStatement(call.getParent()) && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) && fn.getParameters().length <= 1) {
        const statement = call.getParentOrThrow();
        const body = fn.getBody();
        const binding = fn.getParameters()[0]?.getNameNode().getText() ?? '_';
        edit(statement, statement.getStart(), body.getStart(), `for (const ${binding} of ${callee.getExpression().getText()}) `);
        edit(statement, body.getEnd(), statement.getEnd(), Node.isBlock(body) ? '' : ';');
        if (!Node.isBlock(body)) consume(body);
        return markAsync(enclosingFunction(statement), statement);
      }
      if (fn.isAsync?.()) return;
      report(fn, `synchronous callback of .${calleeName}() now awaits the store; fix by hand`);
    };

    /** `expect(() => storeCall()).toThrow(m)` becomes `await expect(storeCall()).rejects.toThrow(m)`. */
    const rejectsInsteadOfThrow = (fn: FunctionNode, expectCall: CallExpression, cause: Node) => {
      const access = expectCall.getParent();
      const matcher = Node.isPropertyAccessExpression(access) ? access.getName() : '';
      const assertion = access?.getParent();
      const body = Node.isArrowFunction(fn) ? fn.getBody() : undefined;
      if (!body || Node.isBlock(body) || !/^toThrow(Error)?$/.test(matcher) || !Node.isCallExpression(assertion) || unwrapParens(body) !== unwrapParens(cause)) {
        return report(fn, 'expect(() => ...) around a store call is not a plain .toThrow(); fix by hand');
      }
      edit(fn, fn.getStart(), body.getStart(), '');
      edit(fn, expectCall.getEnd(), expectCall.getEnd(), '.rejects', 'close');
      consume(assertion);
    };

    /** `ReturnType<typeof helper>` and `ReturnType<TenantStore['method']>` now name a promise; the code meant the settled value. */
    const namesNewPromise = (reference: Node) => {
      if (!Node.isTypeReference(reference) || reference.getTypeName().getText() !== 'ReturnType') return false;
      const outer = reference.getParent();
      if (Node.isTypeReference(outer?.getParent()) && (outer?.getParent() as Node & { getTypeName(): Node }).getTypeName().getText() === 'Awaited') return false;
      if (Node.isTypeReference(outer) && outer.getTypeName().getText() === 'Awaited') return false;
      const argument = reference.getTypeArguments()[0];
      if (Node.isTypeQuery(argument)) return (argument.getExprName().getSymbol()?.getDeclarations() ?? []).flatMap((declaration) => resolveDeclaration(declaration)).some((declaration) => asyncHolders.has(keyOf(declaration)));
      if (Node.isIndexedAccessTypeNode(argument)) return argument.getObjectTypeNode().getType().getProperty(argument.getIndexTypeNode().getText().slice(1, -1))?.getDeclarations().some(isStoreMember) ?? false;
      return false;
    };

    for (const file of sourceFiles()) {
      for (const reference of file.getDescendantsOfKind(SyntaxKind.TypeReference)) {
        if (namesNewPromise(reference)) { edit(reference, reference.getStart(), reference.getStart(), 'Awaited<'); edit(reference, reference.getEnd(), reference.getEnd(), '>', 'close'); }
      }
      for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        if (!isAsyncCall(call)) continue;
        const target = unwrapParens(call);
        const parent = target.getParent();
        const done = Node.isAwaitExpression(parent)
          || isCombinatorArgument(target) || (Node.isArrayLiteralExpression(parent) && isCombinatorArgument(parent))
          || (Node.isReturnStatement(parent) && !insideTryWithCatch(target) && enclosingFunction(target)?.isAsync?.())
          || (Node.isArrowFunction(parent) && parent.getBody() === target && (parent.isAsync() || holderOf(parent) !== undefined) && !isInlineSyncCallback(parent))
          || isRejectsAssertion(target);
        if (done) {
          const fn = enclosingFunction(target);
          const holder = fn && holderOf(fn);
          if (holder && !fn.isAsync?.()) asyncHolders.add(keyOf(holder));
          continue;
        }
        consume(call);
      }
    }

    if (!edits.size) return [...reports].sort();
    for (const [file, list] of edits) {
      let text = file.getFullText();
      for (const item of [...list].sort((a, b) => b.start - a.start || b.end - a.end || b.order - a.order)) text = text.slice(0, item.start) + item.text + text.slice(item.end);
      file.replaceWithText(text);
    }
    console.log(`pass ${pass}: edited ${edits.size} files`);
  }
  throw new Error('No fixpoint after 12 passes');
}

function isInlineSyncCallback(fn: Node) {
  const call = fn.getParent();
  if (!Node.isCallExpression(call)) return false;
  const callee = call.getExpression();
  return Node.isPropertyAccessExpression(callee) && callee.getName() !== 'map';
}

function isRejectsAssertion(node: Node) {
  const expectCall = node.getParent();
  if (!Node.isCallExpression(expectCall) || expectCall.getExpression().getText() !== 'expect') return false;
  const access = expectCall.getParent();
  return Node.isPropertyAccessExpression(access) && (access.getName() === 'rejects' || access.getName() === 'resolves')
    && Node.isAwaitExpression(unwrapParens(access.getParentOrThrow().getParentOrThrow()).getParent());
}


function unconsumedStoreCalls() {
  if (!project.getSourceFileOrThrow(typesPath).getInterface('TenantStore')) throw new Error('src/lib/store/types.ts has no interface TenantStore, so no store call can be found');
  if (!sourceFiles().some((file) => file.getDescendantsOfKind(SyntaxKind.CallExpression).some(isStoreCall))) throw new Error('No store calls found in src/; the check would pass vacuously');
  const findings: string[] = [];
  for (const file of sourceFiles()) {
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (!isStoreCall(call)) continue;
      const target = unwrapParens(call);
      const parent = target.getParent();
      if (Node.isAwaitExpression(parent)) continue;
      if (Node.isReturnStatement(parent) && !insideTryWithCatch(target) && enclosingFunction(target)?.isAsync?.()) continue;
      if (isCombinatorArgument(target) || (Node.isArrayLiteralExpression(parent) && isCombinatorArgument(parent))) continue;
      if (isRejectsAssertion(target)) continue;
      if (Node.isArrowFunction(parent) && parent.getBody() === target) {
        const call = parent.getParent();
        const isMapIntoCombinator = Node.isCallExpression(call) && Node.isPropertyAccessExpression(call.getExpression()) && (call.getExpression() as Node & { getName(): string }).getName() === 'map' && isCombinatorArgument(unwrapParens(call));
        const isHookCallback = Node.isCallExpression(call) && testHooks.has(call.getExpression().getText());
        if (isMapIntoCombinator || isHookCallback || holderOf(parent)) continue;
      }
      findings.push(`${where(call)}  ${call.getText().split('\n')[0].slice(0, 120)}`);
    }
  }
  return findings;
}


type Effect = 'read' | 'write' | 'log';
const logWrites = new Set(['logFeatureFlow', 'recordOperationalError']);

/** A window is new when a store read and a later store write have no await between them in the base revision. */
function raceWindows(base: string) {
  const baseTexts = new Map<string, string>();
  const baseText = (file: SourceFile) => {
    const path = relative(root, file.getFilePath()).replaceAll('\\', '/');
    if (!baseTexts.has(path)) {
      try { baseTexts.set(path, execFileSync('git', ['show', `${base}:${path}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { baseTexts.set(path, ''); }
    }
    return baseTexts.get(path)!;
  };
  const wasAsyncAtBase = (declaration: Node) => {
    const name = (declaration as Node & { getName?(): string | undefined }).getName?.();
    if (!name) return false;
    return new RegExp(`\\basync\\s+function\\s+${name}\\b|\\b${name}\\s*=\\s*async\\b|\\basync\\s+${name}\\s*\\(`).test(baseText(declaration.getSourceFile()));
  };
  const projectFunction = (call: CallExpression) => calleeDeclarations(call).find((declaration) => {
    const path = declaration.getSourceFile().getFilePath();
    return path.startsWith(`${srcDir}/`) && !path.includes('/src/lib/store/') && (Node.isFunctionDeclaration(declaration) || Node.isMethodDeclaration(declaration) || (Node.isVariableDeclaration(declaration) && Node.isArrowFunction(declaration.getInitializer())));
  });
  const bodyOf = (declaration: Node) => Node.isVariableDeclaration(declaration) ? declaration.getInitializerOrThrow() : declaration;
  const summaries = new Map<Node, Effect | null>();
  const effectOf = (call: CallExpression): Effect | null => {
    if (isStoreCall(call)) { const name = storeMethodName(call); return logWrites.has(name) ? 'log' : mutator.test(name) ? 'write' : 'read'; }
    const declaration = projectFunction(call);
    if (!declaration) return null;
    if (!summaries.has(declaration)) {
      summaries.set(declaration, null);
      const effects = bodyOf(declaration).getDescendantsOfKind(SyntaxKind.CallExpression).map(effectOf);
      summaries.set(declaration, effects.includes('write') ? 'write' : effects.includes('read') ? 'read' : effects.includes('log') ? 'log' : null);
    }
    return summaries.get(declaration)!;
  };
  const preExisting = (node: Node) => {
    const operand = unwrapParens((node as Node & { getExpression(): Node }).getExpression());
    const combinator = Node.isCallExpression(operand) && promiseCombinators.test(operand.getExpression().getText());
    const calls = (combinator ? operand.getDescendants() : [operand]).filter(Node.isCallExpression);
    return !calls.some((call) => isStoreCall(call) || (effectOf(call) !== null && !wasAsyncAtBase(projectFunction(call)!)));
  };

  const windows: string[] = [];
  for (const file of sourceFiles()) {
    if (file.getFilePath().includes('/src/lib/store/') || /\.test\.tsx?$/.test(file.getFilePath())) continue;
    for (const fn of file.getDescendants().filter((node) => Node.isFunctionLikeDeclaration(node) && holderOf(node) !== undefined || Node.isFunctionDeclaration(node))) {
      const own = (node: Node) => { const owner = enclosingFunction(node); return owner === fn || (owner !== undefined && holderOf(owner) === undefined && owner.getFirstAncestor((ancestor) => ancestor === fn) !== undefined); };
      const effects = fn.getDescendantsOfKind(SyntaxKind.CallExpression).filter(own).map((call) => ({ call, effect: effectOf(call) })).filter((item) => item.effect);
      const awaits = fn.getDescendantsOfKind(SyntaxKind.AwaitExpression).filter(own);
      for (const write of effects.filter((item) => item.effect !== 'read')) {
        const read = effects.find((item) => item.effect === 'read' && item.call.getEnd() <= write.call.getStart()
          && !awaits.some((node) => node.getEnd() >= item.call.getEnd() && node.getEnd() <= write.call.getStart() && preExisting(node)));
        if (!read) continue;
        const between = awaits.filter((node) => node.getEnd() >= read.call.getEnd() && node.getEnd() <= write.call.getStart()).length;
        if (!between) continue;
        const label = (call: CallExpression) => isStoreCall(call) ? storeMethodName(call) : `${call.getExpression().getText()}()`;
        windows.push(`${where(write.call)}  ${label(read.call)} (line ${read.call.getStartLineNumber()}) -> ${label(write.call)}${write.effect === 'log' ? '  [log append]' : ''}  ${between} new await${between === 1 ? '' : 's'}`);
      }
    }
  }
  return [...new Set(windows)].sort();
}

if (mode === '--check') {
  const findings = unconsumedStoreCalls();
  for (const line of findings) console.log(line);
  console.log(`${findings.length} store call${findings.length === 1 ? '' : 's'} not awaited or returned`);
  process.exitCode = findings.length ? 1 : 0;
} else if (mode === '--races') {
  for (const line of raceWindows(process.argv[process.argv.indexOf('--races') + 1] ?? 'HEAD')) console.log(line);
} else if (mode === '--contract-only') {
  writeContract();
  await project.save();
} else {
  writeContract();
  const reports = sweep();
  await project.save();
  for (const line of reports) console.log(`hand-fix  ${line}`);
  console.log(`${reports.length} site${reports.length === 1 ? '' : 's'} left for a hand fix`);
}
