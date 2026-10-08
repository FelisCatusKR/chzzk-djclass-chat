package web

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// DjangoStatic serves the widget assets straight from the Django tree under
// the URLs Django's collectstatic layout uses (/static/css/…, /static/overlay/…).
// Temporary: the files move into go/ (embedded) at cutover.
func DjangoStatic(repoRoot string) fs.FS {
	return prefixFS{
		"css":     os.DirFS(filepath.Join(repoRoot, "djclass_overlay", "static", "css")),
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
