package web

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// The Docker build copies chat.css, components.js and widget.js into static/
// before compiling, so release binaries carry their assets. In a plain
// checkout static/ holds only its .gitignore.
//
//go:embed all:static
var embeddedStatic embed.FS

// StaticAssets returns the baked-in assets when present, else the files in
// the Django tree under repoRoot (local dev). Either way only css/, js/ and
// overlay/ are reachable.
func StaticAssets(repoRoot string) (fsys fs.FS, embedded bool) {
	sub, _ := fs.Sub(embeddedStatic, "static")
	if _, err := fs.Stat(sub, "overlay/widget.js"); err != nil {
		return DjangoStatic(repoRoot), false
	}
	dir := func(name string) fs.FS { d, _ := fs.Sub(sub, name); return d }
	return prefixFS{"css": dir("css"), "js": dir("js"), "overlay": dir("overlay")}, true
}

// DjangoStatic serves the widget assets straight from the Django tree under
// the URLs Django's collectstatic layout uses (/static/css/…, /static/js/…, /static/overlay/…).
// Temporary: the files move into go/ (embedded) at cutover.
func DjangoStatic(repoRoot string) fs.FS {
	return prefixFS{
		"css":     os.DirFS(filepath.Join(repoRoot, "djclass_overlay", "static", "css")),
		"js":      os.DirFS(filepath.Join(repoRoot, "djclass_overlay", "static", "js")),
		"overlay": os.DirFS(filepath.Join(repoRoot, "djclass_overlay", "overlay", "static", "overlay")),
	}
}

// prefixFS routes "<prefix>/<rest>" to the FS registered for prefix.
type prefixFS map[string]fs.FS

func (p prefixFS) Open(name string) (fs.File, error) {
	prefix, rest, ok := strings.Cut(name, "/")
	sub, found := p[prefix]
	if !ok || !found || !fs.ValidPath(rest) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}
	return sub.Open(rest)
}
