# MatDaily

MatDaily to statyczny prototyp aplikacji webowej do codziennej nauki matematyki. Działa bez instalowania zależności i zapisuje dane w `localStorage`, z wyjątkiem trybu demonstracyjnego, który nie zapisuje zmian na stałe. Program liczy długość kursu bezpośrednio z rozpiski tematów; podane etapy sumują się do 130 dni pracy.

## Uruchomienie

Otwórz plik `index.html` w przeglądarce.

Dane testowe:
- uczeń: `ola.1a` / `1234`
- nauczyciel: `nauczyciel` / `matdaily`

## Pliki

- `index.html` - punkt wejścia aplikacji.
- `styles.css` - responsywny, jasny interfejs.
- `app.js` - dane testowe, widoki, logika ról, losowania, punktacji i paneli.
- `database-schema.md` - projekt docelowej bazy danych.

## Losowanie zadań

Uczeń pracuje na bieżącym temacie zapisanym w postępie. Dla dwóch zadań dziennych aplikacja losuje zadania typu `daily` wyłącznie z aktualnego tematu i pomija zadania zapisane jako rozwiązane poprawnie przez tego ucznia. Po błędnej odpowiedzi pokazuje wskazówkę i losuje inne zadanie z tej samej puli. Po dwóch poprawnych odpowiedziach dzień zostaje zamknięty.

Miniarkusz losuje 4 zadania zamknięte i 2 otwarte typu `mini` z aktualnego tematu. Można go oddać tylko raz dziennie.

## Punktacja

W zadaniach dziennych poprawna odpowiedź za pierwszym razem daje 5 punktów. Poprawna odpowiedź po wcześniejszym błędzie daje 3 punkty.

Punktacja miniarkusza:
- 6 poprawnych: 20 pkt
- 5 poprawnych: 17 pkt
- 4 poprawne: 14 pkt
- 3 poprawne: 11 pkt
- 2 poprawne: 8 pkt
- 1 poprawna: 5 pkt
- 0 poprawnych: 0 pkt

## Dodawanie zadań przez nauczyciela

Nauczyciel loguje się do panelu, przechodzi do zakładki `Dodaj zadanie`, wkleja treść, wpisuje wskazówkę i podaje poprawne odpowiedzi oddzielone średnikiem albo wpisane w osobnych liniach. Pola treści, wskazówki, odpowiedzi i rozwiązania są edytowalnymi polami, do których można wkleić obrazek ze schowka przez `Ctrl + V`, na przykład po zrobieniu zrzutu `Shift + Windows + S`. Obrazek pojawia się bezpośrednio w polu, do którego został wklejony, i można go usunąć przed zapisaniem. Zadanie może mieć treść złożoną wyłącznie z obrazka, ale sprawdzanie odpowiedzi nadal wymaga co najmniej jednej tekstowej poprawnej odpowiedzi. Następnie wybiera level, temat, typ zadania oraz rodzaj odpowiedzi. Aplikacja uznaje tylko podane tekstowe warianty odpowiedzi, ignorując wielkość liter i nadmiarowe spacje.

## Bank zadań i klasy

Zakładka `Zadania` pokazuje bank zadań pogrupowany według leveli i tematów. Levele i tematy można zwijać oraz rozwijać. Przy każdym zadaniu widać treść, załączone obrazki, typ, rodzaj, wskazówkę, poprawne odpowiedzi, rozwiązanie i przycisk usunięcia.

W zakładce `Klasy i uczniowie` przy każdej klasie jest przycisk `Usuń klasę`. Aplikacja wymaga potwierdzenia i informuje, że razem z klasą zostaną usunięci przypisani uczniowie.
