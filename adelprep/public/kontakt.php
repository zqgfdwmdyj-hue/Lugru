<?php
// Anfrageformular von adelprep.de – schickt die Anfrage per E-Mail.
// EINSTELLUNG: Empfänger und Absender (Absender muss eine Adresse von adelprep.de sein).
$EMPFAENGER = 'kontakt@wittmann-grunert.de';
$ABSENDER   = 'formular@adelprep.de';

header('Content-Type: application/json; charset=utf-8');

function antwort($ok, $fehler = '') {
    echo json_encode($ok ? ['ok' => true] : ['ok' => false, 'fehler' => $fehler]);
    exit;
}
function feld($name, $max = 200) {
    $wert = isset($_POST[$name]) && is_string($_POST[$name]) ? trim($_POST[$name]) : '';
    $wert = str_replace(["\r", "\0"], '', $wert);
    return mb_substr($wert, 0, $max);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') antwort(false, 'Ungültige Anfrage.');
// Spam-Falle: echte Besucher sehen dieses Feld nicht
if (feld('website') !== '') antwort(true);

$name  = feld('name');
$email = feld('email');
if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    antwort(false, 'Bitte gib deinen Namen und eine gültige E-Mail-Adresse an.');
}

$leistungen = [];
if (isset($_POST['leistung']) && is_array($_POST['leistung'])) {
    foreach ($_POST['leistung'] as $l) if (is_string($l)) $leistungen[] = mb_substr(trim($l), 0, 50);
}

$zeilen = [
    'Name'                    => $name,
    'Firma'                   => feld('firma'),
    'E-Mail'                  => $email,
    'Telefon'                 => feld('telefon', 50),
    'Einheiten pro Monat'     => feld('menge', 50),
    'Anlieferung'             => feld('art', 50),
    'Versandart'              => feld('modell', 50),
    'Verschiedene Produkte'   => feld('anzahl_produkte', 20),
    'Stück pro Produkt'       => feld('stueck_pro_produkt', 20),
    'Leistungen'              => implode(', ', $leistungen),
];
$text = "Neue Anfrage über adelprep.de\n\n";
foreach ($zeilen as $k => $v) $text .= str_pad($k . ':', 24) . ($v === '' ? '–' : $v) . "\n";
$text .= "\nNachricht:\n" . feld('nachricht', 5000) . "\n";

$betreff = '=?UTF-8?B?' . base64_encode('Anfrage AdelPrep: ' . ($zeilen['Firma'] ?: $name)) . '?=';
$kopf  = "From: AdelPrep Website <$ABSENDER>\r\n";
$kopf .= "Reply-To: $email\r\n";
$kopf .= "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n";

if (mail($EMPFAENGER, $betreff, $text, $kopf, '-f' . $ABSENDER)) antwort(true);
antwort(false, 'Die Anfrage konnte nicht gesendet werden. Bitte schreib uns direkt eine E-Mail.');
