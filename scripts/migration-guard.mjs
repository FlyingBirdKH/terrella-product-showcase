const apply = process.argv.includes("--apply");
if (!apply) {
  console.log(JSON.stringify({
    applied: false,
    responsibility: "Cursor",
    reason: "Refusing to connect or write. Review schema/001_prompt_trace.sql, take a backup, and apply only on a staging copy after approval.",
    rollback: "schema/001_prompt_trace_rollback.sql",
  }));
  process.exit(0);
}
console.error(JSON.stringify({
  applied: false,
  reason: "This guard has no database client and will not write production, even with --apply.",
}));
process.exit(2);
