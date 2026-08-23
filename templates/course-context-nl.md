# Cursuscontext

> [!TIP]
>
> This is the course-context template, in Dutch: the same document with its
> headings, prose and guidance comments in Dutch, for authors who work with
> their AI assistant in Dutch. Copy this file over `context/course-context.md`
> in your project and delete this tip. The document describes _your course_: its
> learning goals, assessment, pedagogy and conventions, so the lesson skills
> (`/lesson-design`, `/lesson-summarize`, `/lesson-module-build`) work from your
> material instead of guessing. It is the course-design companion to
> [`context/writing-style.md`](../context/writing-style.md), which covers
> writing style only, and its sections run in backward-design order: what
> students should be able to do, how you will know they can, and only then how
> they get there. Run `/course-context-init` to fill it in (the skill reads your
> repo and interviews you for the rest) or edit it by hand; a section left on
> `TODO` counts as unanswered, and a skill that needs it will ask and offer to
> save the answer here; `/course-context-update` folds a working session's
> decisions in afterwards. English-language courses want
> [`course-context-en.md`](course-context-en.md) instead. Keep
> `context/course-context.md` in `protected_files` in
> `update-from-upstream.conf`, so
> [upstream updates](../docs/updating-your-project.md) never overwrite your
> version.

## Overzicht van de cursus

<!-- Onderwerp, naam van de cursus, instelling, opleiding, onderwijstaal, niveau
van de studenten (jaar, voorkennis, ERK-niveau als dat relevant is), omvang
(aantal lessen/weken, minuten per les). De machineleesbare cursusnaam en
taalinstelling staan in course.config.yml (`title` benoemt de preview-site,
`language` stuurt de gegenereerde labels en de locale van de site); houd die
consistent met wat je hier schrijft. -->

TODO

## Leerdoelen

<!-- De overkoepelende leerdoelen van de cursus: wat een student op het einde
kan. Zet ze hier, of verwijs naar het document dat ze bevat, en vermeld welke
competenties van de opleiding of het curriculum elk doel concretiseert. Geef ook
de nummering en de exacte notatie waarmee lesplannen, modules en evaluaties naar
een doel verwijzen (bv. `LD3`): /coverage-map, /evaluation-design en
/rubric-build zoeken op die notatie. De leerdoelen van een les zijn
concretiseringen van deze doelen, geen aparte lijst; beschrijf hier hoe een
lesdoel terugverwijst naar het cursusdoel dat het dient. -->

TODO

## Evaluatie

<!-- Hoe je de leerdoelen aantoont. Per evaluatiemoment: de vorm (examen, toets,
portfolio, project), wanneer het valt, het gewicht in het eindcijfer, de
vraagvormen die de cursus gebruikt, de hulpmiddelen die studenten mogen
gebruiken (open of gesloten boek, IDE, spiekbriefje) en welke doelen het dekt.
Vermeld ook de alignmentregel die de cursus zichzelf oplegt, bijvoorbeeld dat
elk doel minstens één keer geëvalueerd wordt, en dat geen enkel doel geëvalueerd
wordt op een hoger niveau dan waarop het ingeoefend is. Evaluatiemateriaal staat
in `evaluations/<jaar>/`; noem het recentste als uitgewerkt voorbeeld. -->

TODO

## Didactiek

<!-- De didactische aanpak van de cursus, gekozen in functie van de leerdoelen
hierboven. Als er een kaderdocument in deze repo staat, verwijs er hier naar en
vat alleen samen wat de skills nodig hebben. Noem ook terugkerende werkvormen
(bv. live coding, PRIMM, uitgewerkte voorbeelden) als lesplannen ernaar
verwijzen. -->

TODO

## Lesplannen

<!-- Waar volledige lesontwerpen staan en hoe ze opgebouwd zijn. Wat de skills
veronderstellen zolang deze sectie TODO is:
- Locatie en naamgeving: `sources/lessons/lesson-NN.md` (nummer met twee
  cijfers).
- Sjabloon: het laagst genummerde bestaande lesplan is het structurele
  voorbeeld.
Vermeld hier welke secties, tijdsafspraken of regels een nieuw lesplan moet
volgen, inclusief hoe een lesplan zijn eigen leerdoelen formuleert en koppelt
aan de cursusdoelen hierboven. -->

TODO

## Klasversies

<!-- Of je lesplannen indikt tot klasversies van één pagina (een geheugensteun
voor in de klas). Standaard: geschreven naar
`sources/lesson-plans/lesson-plan-NN.md`, met hetzelfde nummer als het lesplan;
de inhoudsinventaris als een gewone lijst van concepten. Als je die inventaris
groepeert (bv. passief decor vs. actief ingeoefend vs. gemarkeerd voor later),
definieer die groepen en hun labels hier. -->

TODO

## Moduleconventies

<!-- Hoe een gegenereerde module onder `course/` opgebouwd wordt, bovenop wat
docs/frontmatter.md en writing-style.md al vastleggen: de rollen van de pagina's
en hun volgorde (overzicht, inhoudspagina's, referentiekaarten, samenvatting,
woordenlijst, huiswerk), welke paginatypes je cursus gebruikt, conventies voor
emoji of titels per paginatype, en terugkerende paginastructuren (bv. een
referentiekaart in drie delen). Verwijs naar een of twee bestaande modules als
uitgewerkt voorbeeld. -->

TODO

## Code en downloads

<!-- Alleen voor cursussen met code. De programmeertaal of -talen, hoe
downloadbare projecten in `_files/` opgebouwd zijn (bv. een zip met
`<project>/src/**` voor IntelliJ), wat nooit in een archief terecht mag komen
(IDE-metadata, buildbestanden, gecompileerde artefacten), en de taalregels voor
commentaar in codevoorbeelden. -->

TODO

## Woordenlijst

<!-- Of de cursus een canonieke woordenlijst bijhoudt waaruit de
woordenlijstpagina's per module gegenereerd worden. Standaard als je die
gebruikt: `sources/reference-materials/glossary.yml`, gerenderd met
`npx course build-glossary` (zie --help van het commando voor de flags). Vermeld
het pad, of vermeld dat de cursus geen woordenlijst heeft. -->

TODO

## Niet behandeld

<!-- Onderwerpen die bewust buiten deze cursus vallen, zodat ontwerpgesprekken
ze signaleren in plaats van ze stilzwijgend op te nemen. Zet er telkens één
reden bij (komt later in de opleiding, te hoog gegrepen voor dit niveau, ...).
-->

TODO
