# `project/large-source-file`

Reports source files larger than `maxFileSizeKb` (250 KiB by default). Default: **warning**.

Very large modules can increase parse and transform cost, but size alone does not prove slow runtime behavior. Split responsibilities or ignore reviewed generated files. This rule can be disabled through `rules` like every other rule.
