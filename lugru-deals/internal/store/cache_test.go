package store

import (
	"testing"
	"time"
)

func TestCacheTrefferUndAblauf(t *testing.T) {
	s := temp(t)
	roh := []byte(`{"products":[{"asin":"B01636IZ0G"}]}`)

	if _, da := s.CacheLesen("B01636IZ0G", 3, time.Hour); da {
		t.Error("leerer Cache meldet einen Treffer")
	}

	if err := s.CacheSchreiben("B01636IZ0G", 3, roh); err != nil {
		t.Fatalf("CacheSchreiben: %v", err)
	}

	got, da := s.CacheLesen("B01636IZ0G", 3, time.Hour)
	if !da {
		t.Fatal("frisch geschriebener Eintrag wird nicht gefunden")
	}
	if string(got) != string(roh) {
		t.Errorf("Inhalt weicht ab: %q", got)
	}

	if _, da := s.CacheLesen("B01636IZ0G", 3, 0); da {
		t.Error("abgelaufener Eintrag wird noch geliefert")
	}
}

func TestCacheTrenntMarktplaetze(t *testing.T) {
	s := temp(t)
	s.CacheSchreiben("B01636IZ0G", 3, []byte(`{"markt":"de"}`))

	if _, da := s.CacheLesen("B01636IZ0G", 9, time.Hour); da {
		t.Error("Eintrag für Domain 3 wird für Domain 9 geliefert")
	}
}

func TestCacheUeberschreibt(t *testing.T) {
	s := temp(t)
	s.CacheSchreiben("B01636IZ0G", 3, []byte(`alt`))
	s.CacheSchreiben("B01636IZ0G", 3, []byte(`neu`))

	got, _ := s.CacheLesen("B01636IZ0G", 3, time.Hour)
	if string(got) != "neu" {
		t.Errorf("Cache = %q, will neu", got)
	}
}
