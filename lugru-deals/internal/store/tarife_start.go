package store

import "github.com/trinkfreunde/lugru-deal-discord/internal/fba"

// Die Startbestückung der Tarifstaffel, erzeugt aus Amazons beiden
// Tarifübersichten:
//
//   - „Versandgebühr — lokaler und paneuropäischer Versand durch Amazon",
//     Spalten „Central European Program (DE/PL/CZ)" für DE sowie FR, IT, ES;
//   - „Versandgebühr — Europäisches Versandnetzwerk/Remote Fulfilment",
//     Spalte „Central European Program (DE/PL/CZ)/IT/ES/FR", die dort für alle
//     drei Zielmärkte gemeinsam gilt.
//
// Beide Übersichten haben dasselbe Zeilenraster: identische Größenklassen in
// identischer Reihenfolge. Die Grenzen stehen darum einmal da, die Beträge
// zweimal — einmal je Versandweg.
//
// Das steht hier, obwohl das Tarifwerk ausdrücklich nicht ins Programm gehört,
// und der Unterschied ist wichtig: dies ist eine *Erstbefüllung*, kein
// Nachschlagewerk. Die Zahlen landen einmalig in der Datenbank und werden von
// da an dort gelesen und dort geändert. Wird die Staffel später von Hand
// angepasst, rührt diese Datei sie nie wieder an — auch nicht bei einem
// Programm-Update.
//
// Nicht übernommen: die Spalten „Nur DE" beider Übersichten. Sie liegen in
// jeder einzelnen Zeile exakt 0,26 € über der CEP-Spalte — das ist Fußnote 4,
// der Zuschlag je Einheit aus einem deutschen Logistikzentrum ohne Teilnahme
// am Central Europe Program. Ein Aufschlag auf jede Zeile ist kein zweiter
// Tarif, also steht er als eine Zahl in den Einstellungen.
//
// Ebenfalls nicht übernommen: die Klasse „Sonderübergröße" (über 31,5 kg oder
// mit einer Kante über 175 cm). Für sie führt die lokale Übersicht keinen
// CEP-Betrag, und die EFN-Übersicht kennt sie gar nicht.
//
// Damit dieser Ausschluss auch greift, tragen die beiden letzten Klassen ihre
// echten Schranken statt beliebig großer Ersatzwerte: 175 cm je Kante und
// 31,5 kg. Mit 9999 mm und 999 kg fing „Schwere Übergröße" sonst jedes
// beliebige Paket auf und belegte es mit einem Tarif, den die Übersicht für
// diesen Fall gar nicht kennt — ein 200 × 50 × 50 cm großes Paket zu 40 kg
// bekam so 49,09 € (R4). Jetzt findet es keine Klasse und fällt auf Keepas
// Gebühr zurück, so wie dokumentiert.
//
// Das dritte Merkmal der Sonderübergröße, ein Umfang über 360 cm, lässt sich
// mit drei Kantengrenzen nicht ausdrücken; ein Paket mit 175 × 60 × 60 cm
// rutscht deshalb weiterhin in die Schwere Übergröße, obwohl sein Umfang
// darüber liegt. Dafür bräuchte die Klasse eine eigene Umfangsgrenze.
//
// Nicht abgebildet: das Volumengewicht. Amazon nimmt bei Paketen und
// Übergrößen das größere aus Einheits- und Volumengewicht (Fußnote 3), nimmt
// aber unter anderem „Lebensmittel und Gourmet" ausdrücklich davon aus. Hier
// zählt allein das Paketgewicht aus Keepa.
type tarifStartzeile struct {
	sortierung                  int
	bezeichnung                 string
	laengeMM, breiteMM, hoeheMM int
	gewichtG                    int
	freiGewichtG                int

	// lokal und efn sind die Beträge in Cent je Marktkürzel, dazu der
	// Zuschlag je zusätzlichem Kilogramm. Fehlt ein Markt, gibt es für ihn
	// auf diesem Weg keinen Tarif.
	lokal, efn map[string]tarifStartbetrag
}

type tarifStartbetrag struct {
	cent, centProKg int
}

// tarifStartstaffel ist nach Amazons eigener Reihenfolge sortiert: von der
// kleinsten Klasse zur größten. fba.Waehle nimmt die erste passende, und genau
// diese Reihenfolge macht aus einem Brief keinen Paketpreis.
var tarifStartstaffel = []tarifStartzeile{
	{1, "Leichter Umschlag ≤ 20 g", 330, 230, 25, 20, 0,
		map[string]tarifStartbetrag{"DE": {207, 0}, "FR": {275, 0}, "IT": {323, 0}, "ES": {277, 0}},
		map[string]tarifStartbetrag{"FR": {508, 0}, "IT": {508, 0}, "ES": {508, 0}}},
	{2, "Leichter Umschlag ≤ 40 g", 330, 230, 25, 40, 0,
		map[string]tarifStartbetrag{"DE": {211, 0}, "FR": {276, 0}, "IT": {326, 0}, "ES": {284, 0}},
		map[string]tarifStartbetrag{"FR": {511, 0}, "IT": {511, 0}, "ES": {511, 0}}},
	{3, "Leichter Umschlag ≤ 60 g", 330, 230, 25, 60, 0,
		map[string]tarifStartbetrag{"DE": {213, 0}, "FR": {278, 0}, "IT": {328, 0}, "ES": {287, 0}},
		map[string]tarifStartbetrag{"FR": {516, 0}, "IT": {516, 0}, "ES": {516, 0}}},
	{4, "Leichter Umschlag ≤ 80 g", 330, 230, 25, 80, 0,
		map[string]tarifStartbetrag{"DE": {226, 0}, "FR": {330, 0}, "IT": {339, 0}, "ES": {321, 0}},
		map[string]tarifStartbetrag{"FR": {547, 0}, "IT": {547, 0}, "ES": {547, 0}}},
	{5, "Leichter Umschlag ≤ 100 g", 330, 230, 25, 100, 0,
		map[string]tarifStartbetrag{"DE": {228, 0}, "FR": {332, 0}, "IT": {341, 0}, "ES": {323, 0}},
		map[string]tarifStartbetrag{"FR": {550, 0}, "IT": {550, 0}, "ES": {550, 0}}},
	{6, "Standardumschlag ≤ 210 g", 330, 230, 25, 210, 0,
		map[string]tarifStartbetrag{"DE": {231, 0}, "FR": {333, 0}, "IT": {345, 0}, "ES": {326, 0}},
		map[string]tarifStartbetrag{"FR": {550, 0}, "IT": {550, 0}, "ES": {550, 0}}},
	{7, "Standardumschlag ≤ 460 g", 330, 230, 25, 460, 0,
		map[string]tarifStartbetrag{"DE": {242, 0}, "FR": {377, 0}, "IT": {364, 0}, "ES": {345, 0}},
		map[string]tarifStartbetrag{"FR": {553, 0}, "IT": {553, 0}, "ES": {553, 0}}},
	{8, "Großer Umschlag", 330, 230, 40, 960, 0,
		map[string]tarifStartbetrag{"DE": {278, 0}, "FR": {439, 0}, "IT": {394, 0}, "ES": {360, 0}},
		map[string]tarifStartbetrag{"FR": {609, 0}, "IT": {609, 0}, "ES": {609, 0}}},
	{9, "Extragroßer Umschlag", 330, 230, 60, 960, 0,
		map[string]tarifStartbetrag{"DE": {316, 0}, "FR": {472, 0}, "IT": {417, 0}, "ES": {385, 0}},
		map[string]tarifStartbetrag{"FR": {672, 0}, "IT": {672, 0}, "ES": {672, 0}}},
	{10, "Kleines Paket ≤ 150 g", 350, 250, 120, 150, 0,
		map[string]tarifStartbetrag{"DE": {312, 0}, "FR": {456, 0}, "IT": {413, 0}, "ES": {352, 0}},
		map[string]tarifStartbetrag{"FR": {661, 0}, "IT": {661, 0}, "ES": {661, 0}}},
	{11, "Kleines Paket ≤ 400 g", 350, 250, 120, 400, 0,
		map[string]tarifStartbetrag{"DE": {313, 0}, "FR": {507, 0}, "IT": {454, 0}, "ES": {374, 0}},
		map[string]tarifStartbetrag{"FR": {705, 0}, "IT": {705, 0}, "ES": {705, 0}}},
	{12, "Kleines Paket ≤ 900 g", 350, 250, 120, 900, 0,
		map[string]tarifStartbetrag{"DE": {314, 0}, "FR": {579, 0}, "IT": {495, 0}, "ES": {395, 0}},
		map[string]tarifStartbetrag{"FR": {845, 0}, "IT": {845, 0}, "ES": {845, 0}}},
	{13, "Kleines Paket ≤ 1,4 kg", 350, 250, 120, 1400, 0,
		map[string]tarifStartbetrag{"DE": {315, 0}, "FR": {587, 0}, "IT": {511, 0}, "ES": {421, 0}},
		map[string]tarifStartbetrag{"FR": {928, 0}, "IT": {928, 0}, "ES": {928, 0}}},
	{14, "Kleines Paket ≤ 1,9 kg", 350, 250, 120, 1900, 0,
		map[string]tarifStartbetrag{"DE": {317, 0}, "FR": {610, 0}, "IT": {514, 0}, "ES": {427, 0}},
		map[string]tarifStartbetrag{"FR": {1058, 0}, "IT": {1058, 0}, "ES": {1058, 0}}},
	{15, "Kleines Paket ≤ 3,9 kg", 350, 250, 120, 3900, 0,
		map[string]tarifStartbetrag{"DE": {428, 0}, "FR": {780, 0}, "IT": {516, 0}, "ES": {550, 0}},
		map[string]tarifStartbetrag{"FR": {1342, 0}, "IT": {1342, 0}, "ES": {1342, 0}}},
	{16, "Standardpaket ≤ 150 g", 450, 340, 260, 150, 0,
		map[string]tarifStartbetrag{"DE": {313, 0}, "FR": {458, 0}, "IT": {429, 0}, "ES": {355, 0}},
		map[string]tarifStartbetrag{"FR": {663, 0}, "IT": {663, 0}, "ES": {663, 0}}},
	{17, "Standardpaket ≤ 400 g", 450, 340, 260, 400, 0,
		map[string]tarifStartbetrag{"DE": {316, 0}, "FR": {522, 0}, "IT": {470, 0}, "ES": {377, 0}},
		map[string]tarifStartbetrag{"FR": {773, 0}, "IT": {773, 0}, "ES": {773, 0}}},
	{18, "Standardpaket ≤ 900 g", 450, 340, 260, 900, 0,
		map[string]tarifStartbetrag{"DE": {318, 0}, "FR": {601, 0}, "IT": {515, 0}, "ES": {399, 0}},
		map[string]tarifStartbetrag{"FR": {919, 0}, "IT": {919, 0}, "ES": {919, 0}}},
	{19, "Standardpaket ≤ 1,4 kg", 450, 340, 260, 1400, 0,
		map[string]tarifStartbetrag{"DE": {367, 0}, "FR": {641, 0}, "IT": {526, 0}, "ES": {485, 0}},
		map[string]tarifStartbetrag{"FR": {1043, 0}, "IT": {1043, 0}, "ES": {1043, 0}}},
	{20, "Standardpaket ≤ 1,9 kg", 450, 340, 260, 1900, 0,
		map[string]tarifStartbetrag{"DE": {369, 0}, "FR": {644, 0}, "IT": {529, 0}, "ES": {494, 0}},
		map[string]tarifStartbetrag{"FR": {1197, 0}, "IT": {1197, 0}, "ES": {1197, 0}}},
	{21, "Standardpaket ≤ 2,9 kg", 450, 340, 260, 2900, 0,
		map[string]tarifStartbetrag{"DE": {429, 0}, "FR": {708, 0}, "IT": {530, 0}, "ES": {498, 0}},
		map[string]tarifStartbetrag{"FR": {1342, 0}, "IT": {1342, 0}, "ES": {1342, 0}}},
	{22, "Standardpaket ≤ 3,9 kg", 450, 340, 260, 3900, 0,
		map[string]tarifStartbetrag{"DE": {483, 0}, "FR": {781, 0}, "IT": {535, 0}, "ES": {553, 0}},
		map[string]tarifStartbetrag{"FR": {1580, 0}, "IT": {1580, 0}, "ES": {1580, 0}}},
	{23, "Standardpaket ≤ 5,9 kg", 450, 340, 260, 5900, 0,
		map[string]tarifStartbetrag{"DE": {496, 0}, "FR": {822, 0}, "IT": {538, 0}, "ES": {596, 0}},
		map[string]tarifStartbetrag{"FR": {1667, 0}, "IT": {1667, 0}, "ES": {1667, 0}}},
	{24, "Standardpaket ≤ 8,9 kg", 450, 340, 260, 8900, 0,
		map[string]tarifStartbetrag{"DE": {577, 0}, "FR": {884, 0}, "IT": {541, 0}, "ES": {724, 0}},
		map[string]tarifStartbetrag{"FR": {1806, 0}, "IT": {1806, 0}, "ES": {1806, 0}}},
	{25, "Standardpaket ≤ 11,9 kg", 450, 340, 260, 11900, 0,
		map[string]tarifStartbetrag{"DE": {639, 0}, "FR": {938, 0}, "IT": {625, 0}, "ES": {785, 0}},
		map[string]tarifStartbetrag{"FR": {2124, 0}, "IT": {2124, 0}, "ES": {2124, 0}}},
	{26, "Kleine Übergröße", 610, 460, 460, 1760, 760,
		map[string]tarifStartbetrag{"DE": {430, 18}, "FR": {705, 20}, "IT": {721, 8}, "ES": {568, 4}},
		map[string]tarifStartbetrag{"FR": {1768, 36}, "IT": {1768, 36}, "ES": {1768, 36}}},
	{27, "Standardübergröße Light", 1010, 600, 600, 15000, 760,
		map[string]tarifStartbetrag{"DE": {433, 18}, "FR": {729, 21}, "IT": {745, 22}, "ES": {655, 34}},
		map[string]tarifStartbetrag{"FR": {2155, 78}, "IT": {2155, 78}, "ES": {2155, 78}}},
	{28, "Standardübergröße Heavy", 1010, 600, 600, 23000, 15760,
		map[string]tarifStartbetrag{"DE": {699, 7}, "FR": {1042, 11}, "IT": {1063, 8}, "ES": {1172, 27}},
		map[string]tarifStartbetrag{"FR": {3287, 38}, "IT": {3287, 38}, "ES": {3287, 38}}},
	{29, "Standardübergröße Large", 1200, 600, 600, 23000, 760,
		map[string]tarifStartbetrag{"DE": {580, 8}, "FR": {847, 13}, "IT": {913, 9}, "ES": {676, 33}},
		map[string]tarifStartbetrag{"FR": {2213, 78}, "IT": {2213, 78}, "ES": {2213, 78}}},
	{30, "Sperrige Übergröße", 1750, 1750, 1750, 23000, 760,
		map[string]tarifStartbetrag{"DE": {798, 27}, "FR": {1538, 45}, "IT": {959, 30}, "ES": {995, 43}},
		map[string]tarifStartbetrag{"FR": {3295, 115}, "IT": {3295, 115}, "ES": {3295, 115}}},
	{31, "Schwere Übergröße", 1750, 1750, 1750, 31500, 31500,
		map[string]tarifStartbetrag{"DE": {1274, 15}, "FR": {1559, 18}, "IT": {1685, 15}, "ES": {1400, 12}},
		map[string]tarifStartbetrag{"FR": {3767, 124}, "IT": {3767, 124}, "ES": {3767, 124}}},
}

// SchluesselTarifeBestueckt hält fest, dass die Startbestückung gelaufen ist.
//
// Ohne diese Marke käme die Staffel nach jedem Neustart zurück, und wer sie
// bewusst leert oder eine Klasse löscht, bekäme sie ungefragt wieder — die
// Erstbefüllung würde zur Zwangsbefüllung.
const SchluesselTarifeBestueckt = "versand.tarife_startbestueckung"

// tarifeStand ist der Stand, auf dem die Startbestückung beruht. Er steht
// danach in den Einstellungen und auf der Tarifseite — eine Gebühr ohne Datum
// ist eine Gebühr, deren Alter niemand kennt.
const tarifeStand = "Amazon-Tarifübersichten lokal/paneuropäisch und EFN, Vorlagen vom 2026-09-06"

// tarifeBestuecken legt die Staffel einmalig an.
//
// Ein Fehler hier hält den Start nicht auf: die Staffel ist eine
// Bequemlichkeit, kein Betriebsmittel. Ohne sie rechnet das Programm wie zuvor
// über Keepas Gebühr weiter, und die Tarifseite lässt sie von Hand füllen.
func (s *Store) tarifeBestuecken() error {
	if s.Einstellung(SchluesselTarifeBestueckt) != "" {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, z := range tarifStartstaffel {
		erg, err := tx.Exec(`
			INSERT INTO fba_klassen
			    (sortierung, bezeichnung, max_laenge_mm, max_breite_mm, max_hoehe_mm, max_gewicht_g)
			VALUES (?, ?, ?, ?, ?, ?)`,
			z.sortierung, z.bezeichnung, z.laengeMM, z.breiteMM, z.hoeheMM, z.gewichtG)
		if err != nil {
			return err
		}
		id, err := erg.LastInsertId()
		if err != nil {
			return err
		}

		for _, satz := range []struct {
			weg      fba.Weg
			betraege map[string]tarifStartbetrag
		}{
			{fba.Lokal, z.lokal},
			{fba.EFN, z.efn},
		} {
			for markt, b := range satz.betraege {
				// Das Grundgewicht gilt nur zusammen mit einem Zuschlag je
				// Kilogramm: ohne ihn wäre es eine Angabe ohne Wirkung.
				frei := 0
				if b.centProKg > 0 {
					frei = z.freiGewichtG
				}
				if _, err := tx.Exec(`
					INSERT INTO fba_gebuehren
					    (klasse_id, markt, weg, cent, frei_gewicht_g, cent_pro_kg)
					VALUES (?, ?, ?, ?, ?, ?)`,
					id, markt, string(satz.weg), b.cent, frei, b.centProKg); err != nil {
					return err
				}
			}
		}
	}

	if _, err := tx.Exec(
		`INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?)
		 ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert`,
		SchluesselTarifeBestueckt, tarifeStand); err != nil {
		return err
	}
	return tx.Commit()
}
