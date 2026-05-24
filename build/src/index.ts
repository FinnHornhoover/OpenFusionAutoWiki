// FFAutomatedWiki — build pipeline entrypoint.
// P0: prints a banner and exits 0. Real pipeline lands in P1+.

const banner = `
FFAutomatedWiki build pipeline
------------------------------
P0 stub. The real pipeline (download, extract, normalize, dedupe icons,
chunk per-entity JSON, emit manifest) ships in P1.
`;

function main(): void {
  process.stdout.write(banner);
}

main();
