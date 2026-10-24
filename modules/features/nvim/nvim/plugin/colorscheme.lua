vim.cmd.highlight("clear")
if vim.g.syntax_on then
  vim.cmd.syntax("reset")
end
vim.g.colors_name = "rizesql"
vim.o.termguicolors = false

local RED, GREEN, YELLOW, BLUE, MAGENTA, CYAN = 1, 2, 3, 4, 5, 6
local BRIGHT = 8
local GREY = BRIGHT

-- Generated 6×6×6 cube: each axis runs 0 (background) to 5 (full base color),
-- so low values are base colors tinted faintly over the background.
local function rgb(r, g, b)
  return 16 + r * 36 + g * 6 + b
end

-- Generated 24-step ramp: 0 ≈ background, 23 ≈ foreground, in light themes too.
local function grey(n)
  return 232 + n
end

---@type table<string, string | vim.api.keyset.highlight>
local groups = {
  -- Syntax
  Comment = { ctermfg = GREY, italic = true },
  Constant = { ctermfg = CYAN },
  String = { ctermfg = GREEN },
  Character = "String",
  Number = { ctermfg = YELLOW },
  Boolean = "Number",
  Float = "Number",
  Identifier = {},
  Function = { ctermfg = BLUE },
  Statement = { ctermfg = MAGENTA },
  Conditional = "Statement",
  Repeat = "Statement",
  Label = "Statement",
  Operator = "Statement",
  Keyword = "Statement",
  Exception = { ctermfg = CYAN },
  PreProc = {},
  Include = { ctermfg = BLUE },
  Define = "Statement",
  Macro = "Statement",
  PreCondit = "Type",
  Type = { ctermfg = BRIGHT + YELLOW },
  StorageClass = "Type",
  Structure = "Type",
  Typedef = "Type",
  Special = { ctermfg = MAGENTA },
  SpecialKey = "Special",
  SpecialChar = { ctermfg = grey(12) },
  SpecialComment = { ctermfg = grey(8) },
  Delimiter = {},
  Todo = "Special",
  Question = "Special",
  Title = { ctermfg = GREEN, bold = true },
  Directory = { ctermfg = BLUE },

  -- Messages and diagnostics
  Error = { ctermfg = RED },
  ErrorMsg = "Error",
  WarningMsg = { ctermfg = YELLOW },
  DiagnosticError = "Error",
  DiagnosticWarn = "WarningMsg",
  DiagnosticInfo = { ctermfg = CYAN },
  DiagnosticHint = "DiagnosticInfo",
  DiagnosticOk = { ctermfg = GREEN },
  DiagnosticUnderlineError = { ctermfg = RED, undercurl = true },
  DiagnosticUnderlineWarn = { ctermfg = YELLOW, undercurl = true },
  DiagnosticUnderlineInfo = { undercurl = true },
  DiagnosticUnderlineHint = { undercurl = true },
  DiagnosticUnderlineOk = { undercurl = true },
  DiagnosticUnnecessary = { ctermfg = GREY },
  SpellBad = { ctermfg = RED, undercurl = true },
  SpellCap = { ctermfg = YELLOW, undercurl = true },
  SpellRare = { undercurl = true },
  SpellLocal = { undercurl = true },

  -- Editor UI
  ColorColumn = { ctermbg = grey(1) },
  Cursor = { reverse = true },
  CursorLine = { ctermbg = grey(1) },
  CursorColumn = "CursorLine",
  CursorLineNr = { ctermbg = grey(1), bold = true },
  CursorLineSign = "CursorLine",
  CursorLineFold = "CursorLine",
  LineNr = { ctermfg = grey(6) },
  SignColumn = {},
  Visual = { ctermbg = grey(4) },
  Search = { ctermbg = grey(3) },
  CurSearch = { ctermbg = grey(3), ctermfg = BRIGHT + YELLOW, bold = true },
  IncSearch = "CurSearch",
  MatchParen = { ctermbg = grey(3), ctermfg = MAGENTA },
  NonText = { ctermfg = grey(6) },
  Whitespace = "NonText",
  WinSeparator = { ctermfg = grey(5) },
  Folded = { ctermfg = grey(10), ctermbg = grey(1) },
  QuickFixLine = { bold = true },

  -- Floats, menus, status and tab lines
  NormalFloat = { ctermbg = grey(2) },
  FloatBorder = { ctermfg = grey(6), ctermbg = grey(2) },
  Pmenu = { ctermbg = grey(2) },
  PmenuSel = { ctermbg = grey(5), bold = true },
  PmenuSbar = "Pmenu",
  PmenuThumb = { ctermbg = grey(6) },
  WildMenu = "PmenuSel",
  StatusLine = { ctermbg = grey(2) },
  StatusLineNC = { ctermfg = grey(10), ctermbg = grey(1) },
  TabLine = "StatusLineNC",
  TabLineFill = "StatusLineNC",
  TabLineSel = "StatusLine",

  -- Diffs: faint tints over the background, stronger for changed text
  DiffAdd = { ctermbg = rgb(0, 1, 0) },
  DiffDelete = { ctermbg = rgb(1, 0, 0) },
  DiffChange = { ctermbg = rgb(0, 0, 1) },
  DiffText = { ctermbg = rgb(0, 0, 2) },
  Added = { ctermfg = GREEN },
  Changed = { ctermfg = BLUE },
  Removed = { ctermfg = RED },

  -- Treesitter overrides; other captures link to the groups above by default
  ["@variable"] = {},
  ["@variable.builtin"] = "Identifier",
  ["@constructor"] = "Function",
  ["@function.builtin"] = "Function",
  ["@constant.builtin"] = "Constant",
  ["@type.builtin"] = "Type",
}

for name, spec in pairs(groups) do
  vim.api.nvim_set_hl(0, name, type(spec) == "string" and { link = spec } or spec)
end

vim.api.nvim_exec_autocmds("ColorScheme", { pattern = "rizesql" })
