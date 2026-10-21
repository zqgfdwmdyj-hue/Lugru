package store

import (
	"testing"
	"time"
)

// Die Statistik bleibt auch mit ein paar tausend Deals schnell. Ohne den
// Index auf haupt_id brauchte sie für 5000 Deals über zwei Minuten, und die
// Seite hing.
func TestStatistikBleibtSchnell(t *testing.T) {
	if testing.Short() {
		t.Skip("Lasttest")
	}
	s := oeffneTest(t)
	jetzt := time.Now()
	_, _ = s.db.Exec(`PRAGMA synchronous = OFF`)
	for i := 0; i < 5000; i++ {
		d := testDeal("B0000"+itoa(int64(10000+i)), 10, jetzt.Add(-time.Duration(i)*time.Hour))
		id, err := s.DealAnlegen(d)
		if err != nil {
			t.Fatal(err)
		}
		_ = s.DealReaktionenSetzen(id, i%3, 0, jetzt)
	}
	start := time.Now()
	st, err := s.Statistik(time.Time{}, time.Time{}, "")
	if err != nil || st.Gesamt.Anzahl != 5000 {
		t.Fatalf("%d Deals, %v", st.Gesamt.Anzahl, err)
	}
	if dauer := time.Since(start); dauer > 10*time.Second {
		t.Errorf("Statistik brauchte %v", dauer)
	}
}
