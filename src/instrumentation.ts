export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { checkConfigAtBoot } = await import('./lib/boot');
  checkConfigAtBoot();
}
