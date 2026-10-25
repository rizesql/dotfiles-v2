-- Review pi's edits inline (lua/pi_review.lua). plugin/mini.lua puts its source in
-- front of git for mini.diff.

-- For `nvim --server $NVIM --remote-expr "v:lua.PiReview.refresh()"` once pi runs in
-- an nvim terminal.
_G.PiReview = require("pi_review")

require("lazyload").on_vim_enter(function()
  PiReview.setup()
end)
