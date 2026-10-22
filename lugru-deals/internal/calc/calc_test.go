package calc

import (
	"math"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// referenz ist der Makita HR2630 aus der Spec, ES -> DE.
func referenz() Eingabe {
	return Eingabe{
		EK:               13056,
		EKArt:            EKAlsBrutto,
		VKBrutto:         20749,
		QuellUStPermille: 210, // ES 21 %
		ZielUStPermille:  190, // DE 19 %
		ProvisionProzent: 15.0,
		FBA:              864,
		UStModus:         Netto,
		MargenBasis:      AufBrutto,
	}
}

func TestReferenzfallNetto(t *testing.T) {
	got := Rechne(referenz())

	if got.VKNetto != 17436 {
		t.Errorf("VKNetto = %d, will 17436", got.VKNetto)
	}
	if got.EKNetto != 10790 {
		t.Errorf("EKNetto = %d, will 10790", got.EKNetto)
	}
	if got.Provision != 3112 {
		t.Errorf("Provision = %d, will 3112 — 15 %% auf den Brutto-Verkaufspreis", got.Provision)
	}
	if got.Gewinn != 2670 {
		t.Errorf("Gewinn = %d, will 2670", got.Gewinn)
	}

	// MargeProzent von Hand aus der Formel (Basis AufBrutto: bezug = VKBrutto):
	//   vkNetto   = 20749 * 1000/1190           = 17436,134454 Cent
	//   ekNetto   = 13056 * 1000/1210           = 10790,082645 Cent
	//   provision = 20749 * 15/100              =  3112,350000 Cent (Basis: VK brutto)
	//   gewinn    = 17436,134454 - 10790,082645
	//               - 3112,350000 - 864         =  2669,701809 Cent (vor Rundung)
	//   marge     = 2669,701809 / 20749 * 100   =    12,8666529 %
	// Würden vkNetto/ekNetto/provision vor der Kombination auf ganze Cent
	// gerundet, ergäbe sich zwar derselbe gewinn = 2670, aber
	// marge ≈ 12,8681 % — außerhalb der 1e-6-Toleranz.
	const wantMarge = 12.8666529
	if math.Abs(got.MargeProzent-wantMarge) > 1e-6 {
		t.Errorf("MargeProzent = %.7f, will %.7f", got.MargeProzent, wantMarge)
	}
}

func TestReferenzfallBrutto(t *testing.T) {
	ein := referenz()
	ein.UStModus = Brutto
	got := Rechne(ein)

	// EKNetto ist auch hier der echte Nettopreis — der Brutto-Modus ändert
	// nicht, was der Nettopreis ist, sondern nur, welche der beiden Größen
	// als Kosten in den Gewinn eingeht (hier der Bruttopreis). Vor der
	// Einführung von EKArt trug EKNetto in diesem Modus stattdessen den
	// ungekürzten Bruttobetrag; die Aufschlüsselung in Schritt 3 hätte
	// daraus eine falsche Vorsteuerzeile gebaut.
	if got.EKNetto != 10790 {
		t.Errorf("EKNetto = %d, will 10790 — auch im Brutto-Modus bleibt der Nettopreis der Nettopreis", got.EKNetto)
	}
	if got.EKBrutto != 13056 {
		t.Errorf("EKBrutto = %d, will 13056", got.EKBrutto)
	}
	if got.Gewinn != 404 {
		t.Errorf("Gewinn = %d, will 404", got.Gewinn)
	}

	// MargeProzent von Hand aus der Formel (Brutto-Modus: die Kosten bleiben der Bruttopreis):
	//   vkNetto   = 20749 * 1000/1190           = 17436,134454 Cent (wie im Netto-Fall)
	//   kosten    = 13056                       = 13056,000000 Cent (brutto, ungekürzt)
	//   provision = 20749 * 15/100              =  3112,350000 Cent (Basis: VK brutto)
	//   gewinn    = 17436,134454 - 13056,000000
	//               - 3112,350000 - 864         =   403,784454 Cent (vor Rundung)
	//   marge     = 403,784454 / 20749 * 100    =     1,9460430 %
	// Würden vkNetto/kosten/provision vor der Kombination auf ganze Cent
	// gerundet, ergäbe sich zwar derselbe gewinn = 404, aber
	// marge ≈ 1,9471 % — außerhalb der 1e-6-Toleranz.
	const wantMarge = 1.9460430
	if math.Abs(got.MargeProzent-wantMarge) > 1e-6 {
		t.Errorf("MargeProzent = %.7f, will %.7f", got.MargeProzent, wantMarge)
	}
}

func TestBruttoLaesstVKUnberuehrt(t *testing.T) {
	ein := referenz()
	ein.UStModus = Brutto
	got := Rechne(ein)
	if got.VKNetto != 17436 {
		t.Errorf("VKNetto = %d, will 17436 — der Brutto-Schalter darf nur die EK-Seite betreffen", got.VKNetto)
	}
}

func TestMargenBasisNetto(t *testing.T) {
	ein := referenz()
	ein.MargenBasis = AufNetto
	got := Rechne(ein)

	// MargeProzent von Hand aus der Formel (Basis AufNetto: bezug = vkNetto statt VKBrutto):
	//   vkNetto   = 20749 * 1000/1190              = 17436,134454 Cent
	//   ekNetto   = 13056 * 1000/1210              = 10790,082645 Cent
	//   provision = 20749 * 15/100                 =  3112,350000 Cent (Basis: VK brutto)
	//   gewinn    = 17436,134454 - 10790,082645
	//               - 3112,350000 - 864            =  2669,701809 Cent (vor Rundung, wie im Referenzfall)
	//   marge     = 2669,701809 / 17436,134454*100 =    15,3113169 %
	// Würden vkNetto/ekNetto/provision vor der Kombination auf ganze Cent
	// gerundet, ergäbe sich gewinn = 2670; da dieselbe (dann gerundete)
	// vkNetto-Variable auch als AufNetto-Bezugsgröße dient, wäre zusätzlich
	// bezug = 17436 statt 17436,134454, macht marge = 2670/17436*100 ≈ 15,3131 %
	// — außerhalb der 1e-6-Toleranz.
	const wantMarge = 15.3113169
	if math.Abs(got.MargeProzent-wantMarge) > 1e-6 {
		t.Errorf("MargeProzent = %.7f, will %.7f", got.MargeProzent, wantMarge)
	}
}

func TestOhneGebuehren(t *testing.T) {
	ein := referenz()
	ein.ProvisionProzent = 0
	ein.FBA = 0
	got := Rechne(ein)
	if got.Provision != 0 {
		t.Errorf("Provision = %d, will 0", got.Provision)
	}
	if will := money.Cents(17436 - 10790); got.Gewinn != will {
		t.Errorf("Gewinn = %d, will %d", got.Gewinn, will)
	}
}

func TestNullVKErgibtNullMarge(t *testing.T) {
	ein := referenz()
	ein.VKBrutto = 0
	got := Rechne(ein)
	if got.MargeProzent != 0 {
		t.Errorf("MargeProzent = %v, will 0 statt einer Division durch null", got.MargeProzent)
	}
}

func TestVerlustDealBleibtNegativ(t *testing.T) {
	ein := referenz()
	ein.EK = 30000
	got := Rechne(ein)

	// Gewinn von Hand aus der Formel:
	//   vkNetto   = 20749 * 1000/1190           = 17436,134454 Cent
	//   ekNetto   = 30000 * 1000/1210           = 24793,388430 Cent
	//   provision = 20749 * 15/100              =  3112,350000 Cent (Basis: VK brutto)
	//   gewinn    = 17436,134454 - 24793,388430
	//               - 3112,350000 - 864         = -11333,603976 Cent (vor Rundung)
	//             -> gerundet: -11334
	if got.Gewinn != -11334 {
		t.Errorf("Gewinn = %d, will -11334", got.Gewinn)
	}
	if got.MargeProzent >= 0 {
		t.Errorf("MargeProzent = %.4f, will negativ", got.MargeProzent)
	}
}

func TestRundungErstAmEnde(t *testing.T) {
	// Drei Divisionen hintereinander: würde jede einzeln gerundet, wiche das
	// Ergebnis sichtbar ab. Der Referenzfall (EK 13056) taugt dafür nicht
	// als Diskriminator: er landet zufällig auch bei früher Rundung auf densel-
	// ben Cent-Wert (2670). Der Verlustfall (EK 30000, sonst wie
	// referenz()) unterscheidet dagegen wirklich:
	//
	//   vkNetto   = 20749 * 1000/1190           = 17436,134454 Cent
	//   ekNetto   = 30000 * 1000/1210           = 24793,388430 Cent
	//   provision = 20749 * 15/100              =  3112,350000 Cent (Basis: VK brutto)
	//   gewinn    = 17436,134454 - 24793,388430
	//               - 3112,350000 - 864         = -11333,603976 Cent (vor Rundung)
	//             -> korrekt (spät gerundet):      -11334
	//             -> würden vkNetto, ekNetto und provision hingegen schon vor
	//                der Kombination auf ganze Cent gerundet, ergäbe sich
	//                stattdessen exakt -11333.
	//
	// Dieser Input ist damit der einzige in der Suite, an dem sich "erst am
	// Ende runden" tatsächlich prüfen lässt.
	ein := referenz()
	ein.EK = 30000
	got := Rechne(ein)
	if got.Gewinn != -11334 {
		t.Errorf("Gewinn = %d, will -11334 — Zwischenwerte dürfen nicht gerundet werden (früh gerundet ergäbe -11333)", got.Gewinn)
	}
}

// TestNettoEingabeRechnetDenBruttopreisHoch prüft den Schalter aus Schritt 2
// des Funnels: derselbe Deal, aber der Einkaufspreis wird als Nettobetrag
// eingegeben. 107,90 € netto sind bei 21 % spanischer USt genau die
// 130,56 € brutto des Referenzfalls (auf den Cent gerundet) — Gewinn und
// Marge müssen daher praktisch dieselben sein wie dort.
func TestNettoEingabeRechnetDenBruttopreisHoch(t *testing.T) {
	ein := referenz()
	ein.EK = 10790
	ein.EKArt = EKAlsNetto
	got := Rechne(ein)

	if got.EKNetto != 10790 {
		t.Errorf("EKNetto = %d, will 10790 — ein netto eingegebener Preis darf nicht noch einmal gekürzt werden", got.EKNetto)
	}
	// 10790 * 1210/1000 = 13055,9 -> gerundet 13056
	if got.EKBrutto != 13056 {
		t.Errorf("EKBrutto = %d, will 13056 — aus dem Nettopreis wird mit dem USt-Satz des Einkaufslands hochgerechnet", got.EKBrutto)
	}
	if got.Gewinn != 2670 {
		t.Errorf("Gewinn = %d, will 2670 — derselbe Deal, nur netto eingegeben", got.Gewinn)
	}
}

// TestBruttoEingabeLiefertBeideSeiten sichert, dass EKBrutto auch im
// Standardfall gefüllt ist: die Aufschlüsselung in Schritt 3 zeigt immer
// beide Zeilen (brutto, abzüglich Vorsteuer, netto), gleich welche Größe
// eingegeben wurde.
func TestBruttoEingabeLiefertBeideSeiten(t *testing.T) {
	got := Rechne(referenz())
	if got.EKBrutto != 13056 {
		t.Errorf("EKBrutto = %d, will 13056 — der eingegebene Bruttopreis unverändert", got.EKBrutto)
	}
	if got.EKNetto != 10790 {
		t.Errorf("EKNetto = %d, will 10790", got.EKNetto)
	}
}

// TestNettoEingabeOhneVorsteuerabzugKostetBrutto deckt die Kombination ab,
// die es ohne die Trennung von EKArt und UStModus nicht geben könnte: netto
// eingegeben, Vorsteuer aber nicht abziehbar. Dann kostet der Einkauf den
// hochgerechneten Bruttopreis — das eingegebene Netto ist in diesem Fall
// nur die Rechnungszeile, nicht die tatsächliche Belastung.
func TestNettoEingabeOhneVorsteuerabzugKostetBrutto(t *testing.T) {
	ein := referenz()
	ein.EK = 10790
	ein.EKArt = EKAlsNetto
	ein.UStModus = Brutto
	got := Rechne(ein)

	// Wie TestReferenzfallBrutto, nur dass die 13056 hier aus 10790 netto
	// hochgerechnet werden (10790 * 1,21 = 13055,9).
	//   vkNetto   = 20749 * 1000/1190     = 17436,134454 Cent
	//   kosten    = 10790 * 1210/1000     = 13055,900000 Cent
	//   provision = 20749 * 15/100        =  3112,350000 Cent (Basis: VK brutto)
	//   gewinn    = 17436,134454 - 13055,9
	//               - 3112,350000 - 864   =   403,884454 Cent -> 404
	if got.Gewinn != 404 {
		t.Errorf("Gewinn = %d, will 404 — ohne Vorsteuerabzug zählt der Bruttopreis als Kosten", got.Gewinn)
	}
}

// NettoAusBrutto ist dieselbe Rechnung, die Rechne intern für die
// Einkaufsseite benutzt — exportiert, damit der Keepa-Vorschlag in Schritt 2
// nicht seine eigene Umsatzsteuerformel mitbringt.
func TestNettoAusBrutto(t *testing.T) {
	faelle := []struct {
		brutto      money.Cents
		ustPermille int
		will        money.Cents
	}{
		{21498, 210, 17767}, // Amazon.es, 21 % — 214,98 € brutto
		{11900, 190, 10000}, // glatte 100,00 € netto bei 19 %
		{13056, 0, 13056},   // ohne bekannten Satz bleibt der Betrag stehen
		{0, 210, 0},
	}
	for _, f := range faelle {
		if got := NettoAusBrutto(f.brutto, f.ustPermille); got != f.will {
			t.Errorf("NettoAusBrutto(%d, %d) = %d, will %d", f.brutto, f.ustPermille, got, f.will)
		}
	}
}
