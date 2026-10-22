package billiger

import (
	"testing"
	"time"
)

func TestMaxLiefertage(t *testing.T) {
	jetzt := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	for text, will := range map[string]int{
		"1-3 Werktage": 3,
		"Sofort lieferbar, Lieferzeit max. 1-3 Werktage":           3,
		"lieferbar - in 2-3 Werktagen bei dir":                     3,
		"Lieferung in 1 - 2 Werktagen":                             2,
		"ca. 2-3 Werktagen versandbereit, Lieferzeit 3-4 Werktage": 4,
		"Bis zu 4 Werktage":                                        4,
		"5-7 Werktage":                                             7,
		"1 Werktag":                                                1,
		"2-3 Wochen":                                               21,
		"Auf Lager":                                                1,
		"sofort ab Lager / 24h-Service möglich":                    1,
		"Nur noch 1 auf Lager":                                     1,
		"Lieferbar ab 30.10.2026":                                  9,
		"lieferbar ab 15.01.":                                      86,
	} {
		got, ok := MaxLiefertage(text, jetzt)
		if !ok || got != will {
			t.Errorf("%q → %d, %v; will %d", text, got, ok, will)
		}
	}
	if _, ok := MaxLiefertage("Vorbestellung", jetzt); ok {
		t.Error("Vorbestellung ohne Angabe als bekannt gewertet")
	}
}
