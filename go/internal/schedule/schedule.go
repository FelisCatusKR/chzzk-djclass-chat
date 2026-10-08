// Package schedule runs a job once a day at a fixed UTC hour, in-process
// (port of overlay/scheduler.py: no worker container, no external cron).
package schedule

import (
	"context"
	"time"
)

// Until returns the time from now to the next hourUTC:00:00 UTC. Exactly at
// the hour it is a full day, so a run never immediately repeats.
func Until(hourUTC int, now time.Time) time.Duration {
	now = now.UTC()
	next := time.Date(now.Year(), now.Month(), now.Day(), hourUTC, 0, 0, 0, time.UTC)
	if !next.After(now) {
		next = next.AddDate(0, 0, 1)
	}
	return next.Sub(now)
}

// Daily calls job at hourUTC every day until ctx is done. job runs on this
// goroutine; a slow job delays the next run rather than overlapping it.
func Daily(ctx context.Context, hourUTC int, job func(context.Context)) {
	for {
		t := time.NewTimer(Until(hourUTC, time.Now()))
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
			job(ctx)
		}
	}
}
