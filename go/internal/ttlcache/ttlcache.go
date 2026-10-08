// Package ttlcache is a small in-memory cache with a TTL per entry and a size
// cap that evicts the oldest-inserted entry (port of common/cache.py). Safe for
// concurrent use. Reading an entry does not extend its TTL.
package ttlcache

import (
	"container/list"
	"sync"
	"time"
)

type entry[V any] struct {
	key     string
	value   V
	expires time.Time
}

type Cache[V any] struct {
	mu    sync.Mutex
	max   int
	items map[string]*list.Element // → *entry[V]
	order *list.List               // insertion order, oldest at front
	now   func() time.Time
}

// New returns a cache holding at most maxEntries; now is injectable for tests
// (nil = time.Now).
func New[V any](maxEntries int, now func() time.Time) *Cache[V] {
	if now == nil {
		now = time.Now
	}
	return &Cache[V]{max: maxEntries, items: map[string]*list.Element{}, order: list.New(), now: now}
}

func (c *Cache[V]) Get(key string) (V, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.items[key]
	if !ok {
		var zero V
		return zero, false
	}
	e := el.Value.(*entry[V])
	if !c.now().Before(e.expires) {
		c.remove(el)
		var zero V
		return zero, false
	}
	return e.value, true
}

// Set stores value for ttl. Overwriting a key keeps its insertion position
// (like a Python dict), so it is evicted as early as it would have been.
func (c *Cache[V]) Set(key string, value V, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	expires := c.now().Add(ttl)
	if el, ok := c.items[key]; ok {
		e := el.Value.(*entry[V])
		e.value, e.expires = value, expires
		return
	}
	if len(c.items) >= c.max {
		c.remove(c.order.Front())
	}
	c.items[key] = c.order.PushBack(&entry[V]{key: key, value: value, expires: expires})
}

func (c *Cache[V]) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[key]; ok {
		c.remove(el)
	}
}

func (c *Cache[V]) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items)
}

func (c *Cache[V]) remove(el *list.Element) {
	delete(c.items, el.Value.(*entry[V]).key)
	c.order.Remove(el)
}
