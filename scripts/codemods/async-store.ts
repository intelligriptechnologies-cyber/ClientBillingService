// Usage: node scripts/codemods/async-store.ts --check
//   Lists store calls in src/ that are neither awaited nor returned, and exits 1 if any. ADR 0001 unit D1 ran this
//   file as a codemod that made the store async. Its rewrite modes read the SQLite factory, so they went with it in
//   unit D12. The check stays: `NextResponse.json(store.method())` type-checks, and no-floating-promises cannot see it.
import { relative, resolve } from 'node:path';
import { Node, Project, SyntaxKind, type CallExpression } from 'ts-morph';

if (!process.argv.includes('--check')) {
  console.error('Usage: node scripts/codemods/async-store.ts --check');
  process.exit(2);
}

const root = resolve(import.meta.dirname, '..', '..');
const srcDir = resolve(root, 'src').replaceAll('\\', '/');
const typesPath = resolve(root, 'src/lib/store/types.ts');

const project = new Project({ tsConfigFilePath: resolve(root, 'tsconfig.json') });
const sourceFiles = () => project.getSourceFiles().filter((file) => file.getFilePath().startsWith(`${srcDir}/`));
const where = (node: Node) => `${relative(root, node.getSourceFile().getFilePath()).replaceAll('\\', '/')}:${node.getStartLineNumber()}`;

type FunctionNode = Node & { isAsync?: () => boolean };
const testHooks = new Set(['it', 'test', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll']);
const promiseCombinators = /^Promise\.(all|allSettled|race|any)$/;

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

const findings = unconsumedStoreCalls();
for (const line of findings) console.log(line);
console.log(`${findings.length} store call${findings.length === 1 ? '' : 's'} not awaited or returned`);
process.exitCode = findings.length ? 1 : 0;
