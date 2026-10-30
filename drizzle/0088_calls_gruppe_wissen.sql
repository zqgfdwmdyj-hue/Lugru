-- Archiv-Calls mit drei oder mehr Teilnehmern sind Gruppen-Calls (Deal-Gruppe), nicht der Consultant-Call.
UPDATE calls SET art = 'gruppe', titel = regexp_replace(titel, '^Consultant-Call ', 'Deal-Gruppe ')
WHERE quelle = 'archiv' AND art = 'consultant' AND jsonb_typeof(zusammenfassung -> 'teilnehmer') = 'array' AND jsonb_array_length(zusammenfassung -> 'teilnehmer') >= 3;
--> statement-breakpoint
-- Calls ohne Transkript: Wissen jetzt aus der Zusammenfassung ziehen (vorher „Transkript zu kurz“).
UPDATE calls SET wissen_am = NULL, wissen_fehler = NULL WHERE wissen_fehler = 'Transkript zu kurz';
