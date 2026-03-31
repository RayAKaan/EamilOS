export function versionCommand(version: string): void {
  console.log(`eamilos v${version}`);
  console.log(`Node.js ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
}
