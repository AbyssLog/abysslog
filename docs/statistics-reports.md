# Statistics reports

The Statistics page keeps its overview tiles, date controls, and activity chart
above the Report Builder. Current-session metrics are shown on Tracker. The
selected Statistics date range also applies to reports and History drill-through.

## Run Performance

Run Performance can filter by tier, weather, outcome, hull, or canonical fit. A
report can group by up to two of these dimensions.

Available columns:

- Abyssal Runs, Ship Entries, Survived, and Died
- Survival %
- Avg, Min, and Max Duration
- Avg Net and Total Net
- Avg Death Loss and Total Death Losses

Duration uses every run in the filtered population. Select `Outcome = Survived`
for survival-only duration figures. Net metrics use survived runs only. Death
losses are available as separate metrics, matching the Statistics overview.

An Abyssal Run is one encounter. Ship Entries count the participating character
runs. Hull, fit, outcome, and survival figures remain participant-based. Net
totals combine the captured economics of the matching participants.

## Item Drops

Item Drops can report one exact item or every observed item. Item suggestions
filter as you type.

When no item is selected, Item becomes the first result column without using one
of the two grouping selectors. This allows reports such as Item by Tier and
Weather or Item by Hull and Fit. Tier, weather, hull, and fit can also be used as
filters.

### Eligible loot runs

A Loot Run must meet all of these conditions:

- the run survived;
- both before and after cargo snapshots parsed completely;
- at least one cargo item had a positive quantity increase.

Deaths, no-loot runs, missing or incomplete snapshots, drone changes, prices,
net values, and older appraisal revisions do not affect Item Drops reports.

### Item columns

- **Loot Runs:** eligible runs where any cargo loot was gained.
- **Runs with Drop:** Loot Runs where the selected item increased.
- **Drop Rate:** Runs with Drop divided by Loot Runs.
- **Total Qty:** total positive quantity increase for the item.
- **Avg Qty / Run:** Total Qty divided by Loot Runs. Loot Runs where another
  item dropped still count in the denominator.
- **Min Drop and Max Drop:** smallest and largest positive increase in one run.

Item names are compared case-insensitively against the exact EVE item name.
When an unscoped report includes a group encounter, participant cargo changes
are combined and the encounter contributes one loot observation. Character,
hull, or fit scoped reports retain participant-level inventory semantics.

## Building a report

1. Select a preset or report type.
2. Add any filters.
3. Select a primary and optional secondary grouping.
4. Choose the columns.
5. Select **Run Report**.

Select a column heading to sort the results. Select **View runs** to open History
with the report date range, filters, and row dimensions applied. Item drill-through
uses the same positive cargo-change rule as the report. It does not replace or
limit the global History search.

## Current limits

Reports support two grouping dimensions and tabular results. Saved report
definitions, report charts, pivot layouts, and direct report CSV export are not
included. Use History drill-through to inspect or export the matching runs.
