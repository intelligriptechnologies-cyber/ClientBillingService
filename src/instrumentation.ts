export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { checkAuthConfigAtBoot } = await import('./lib/auth/boot');
  checkAuthConfigAtBoot();
}
