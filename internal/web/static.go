package web

import (
	"embed"
	"io/fs"
)

// Widget and config-page assets (chat.css, components.js, widget.js) are
// embedded in the binary and served under /static/.
//
//go:embed static
var staticFS embed.FS

// StaticAssets is the embedded asset tree rooted at static/.
func StaticAssets() fs.FS {
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		panic(err) // static/ is embedded at compile time
	}
	return sub
}
