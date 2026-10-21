package marketplace

import "testing"

func TestTabelle(t *testing.T) {
	faelle := []struct {
		code        Code
		keepaDomain int
		chartDomain string
		vatPermille int
		tld         string
	}{
		{DE, 3, "de", 190, "de"},
		{FR, 4, "fr", 200, "fr"},
		{IT, 8, "it", 220, "it"},
		{ES, 9, "es", 210, "es"},
	}
	for _, f := range faelle {
		m, ok := ByCode(f.code)
		if !ok {
			t.Fatalf("ByCode(%q): nicht gefunden", f.code)
		}
		if m.KeepaDomain != f.keepaDomain {
			t.Errorf("%s KeepaDomain = %d, will %d", f.code, m.KeepaDomain, f.keepaDomain)
		}
		if m.ChartDomain != f.chartDomain {
			t.Errorf("%s ChartDomain = %q, will %q", f.code, m.ChartDomain, f.chartDomain)
		}
		if m.VATPermille != f.vatPermille {
			t.Errorf("%s VATPermille = %d, will %d", f.code, m.VATPermille, f.vatPermille)
		}
		if m.TLD != f.tld {
			t.Errorf("%s TLD = %q, will %q", f.code, m.TLD, f.tld)
		}
	}
	if len(All()) != 4 {
		t.Errorf("All() hat %d Einträge, will 4", len(All()))
	}
}

func TestByHost(t *testing.T) {
	faelle := map[string]Code{
		"www.amazon.de": DE,
		"amazon.de":     DE,
		"WWW.AMAZON.ES": ES,
		"amazon.it":     IT,
		"www.amazon.fr": FR,
	}
	for host, will := range faelle {
		m, ok := ByHost(host)
		if !ok {
			t.Errorf("ByHost(%q): nicht gefunden", host)
			continue
		}
		if m.Code != will {
			t.Errorf("ByHost(%q) = %s, will %s", host, m.Code, will)
		}
	}
	if _, ok := ByHost("www.amazon.co.uk"); ok {
		t.Error("ByHost(amazon.co.uk): darf nicht gefunden werden, UK ist nicht unterstützt")
	}
}

func TestProductURL(t *testing.T) {
	m, _ := ByCode(ES)
	will := "https://www.amazon.es/dp/B01636IZ0G"
	if got := m.ProductURL("B01636IZ0G"); got != will {
		t.Errorf("ProductURL = %q, will %q", got, will)
	}
}

func TestProductURLMitTag(t *testing.T) {
	m, _ := ByCode(DE)
	faelle := []struct {
		name string
		tag  string
		will string
	}{
		{
			name: "Tag wird angehängt",
			tag:  "beispiel-21",
			will: "https://www.amazon.de/dp/B01636IZ0G?tag=beispiel-21",
		},
		{
			// Ohne diesen Fall bekäme ein Post ohne gewählten Tag ein
			// nacktes "?tag=" in den Link — sichtbarer Ballast in einer
			// Adresse, die sonst niemand hinterfragt.
			name: "leerer Tag ergibt den blanken Link",
			tag:  "",
			will: "https://www.amazon.de/dp/B01636IZ0G",
		},
		{
			// Die zweite Verteidigungslinie hinter der Formatprüfung der
			// Tag-Seite: was die Funktion baut, muss ein einziger Link
			// bleiben, auch wenn der Aufrufer Unfug übergibt.
			name: "kodierungsbedürftiger Tag bricht den Link nicht auf",
			tag:  "a&b c=d",
			will: "https://www.amazon.de/dp/B01636IZ0G?tag=a%26b+c%3Dd",
		},
	}
	for _, f := range faelle {
		t.Run(f.name, func(t *testing.T) {
			if got := m.ProductURLMitTag("B01636IZ0G", f.tag); got != f.will {
				t.Errorf("ProductURLMitTag = %q, will %q", got, f.will)
			}
		})
	}
}

func TestCodesLiestBekannteKuerzelInReihenfolge(t *testing.T) {
	got := Codes([]string{"IT", "de", " ES "})

	if len(got) != 3 {
		t.Fatalf("len = %d, will 3: %v", len(got), got)
	}
	for i, will := range []Code{IT, DE, ES} {
		if got[i].Code != will {
			t.Errorf("got[%d].Code = %q, will %q", i, got[i].Code, will)
		}
	}
}

// Die Liste kommt aus einem Formular oder aus einer Einstellung. Beides darf
// keinen Markt erfinden, den es nicht gibt, und keinen doppelt rechnen — ein
// zweimal gesendetes DE ergäbe sonst zwei DE-Spalten mit denselben Zahlen.
func TestCodesUebergehtUnbekannteUndDoppelte(t *testing.T) {
	got := Codes([]string{"DE", "XX", "", "DE", "../etc"})

	if len(got) != 1 || got[0].Code != DE {
		t.Fatalf("Codes = %v, will genau [DE]", got)
	}
}

func TestCodesAusListeTrenntAnKomma(t *testing.T) {
	faelle := []struct {
		roh  string
		will int
	}{
		{"DE,FR,IT,ES", 4},
		{"DE", 1},
		{" DE , IT ", 2},
		{"", 0},
		{"   ", 0},
	}
	for _, f := range faelle {
		if n := len(CodesAusListe(f.roh)); n != f.will {
			t.Errorf("CodesAusListe(%q) hat %d Einträge, will %d", f.roh, n, f.will)
		}
	}
}
