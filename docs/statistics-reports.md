# Statistics reports

AbyssLog keeps the Statistics overview tiles, latest session, date range, and activity
chart fixed. The Report Builder below them provides two typed report modes.

## Run Performance

Run Performance can be filtered by tier, weather, outcome, hull, or canonical fit and
grouped by up to two of:

- tier;
- weather;
- outcome;
- hull;
- fit.

Available metrics are runs, survived, died, survival percentage, average/minimum/maximum
duration, average net, and total net. Duration metrics use every run in the filtered
population; select Outcome = Survived to calculate survival-only durations. Deaths
contribute their negative total loss to net metrics, matching the Statistics overview.

## Item Drops

Item Drops can select one exact item or report all observed items. When no item is
selected, Item is added automatically as the first result column and does not consume
one of the two available breakdowns. Reports can therefore show Item by Tier and Weather,
or Item by Hull and Fit. Tier, weather, hull, and fit are also available as filters.

An eligible loot run is a survived run with complete before-and-after cargo snapshots
and at least one positive cargo-quantity increase. For each item, AbyssLog calculates:

- **Loot Runs** — eligible survived runs where any cargo loot was gained;
- **Runs with Drop** — Loot Runs with a positive increase for the selected item;
- **Drop Rate** — Runs with Drop divided by Loot Runs;
- **Total Qty** — sum of positive increases;
- **Avg Qty / Run** — Total Qty divided by Loot Runs, including Loot Runs where
  other items were gained but the selected item was not;
- **Min/Max Drop** — smallest or largest positive increase in one run.

Deaths, runs with no positive cargo gain, missing snapshots, unparseable snapshots,
drone-bay changes, prices, net values, and older appraisal revisions do not affect drop quantities.
Item identity is the exact EVE item name compared case-insensitively.

## Building a report

1. Select a built-in preset or report mode.
2. Add optional filters.
3. Choose a primary and optional secondary grouping.
4. Select the columns to display.
5. Choose **Run Report**.

Select a table heading to sort by that dimension or metric. **View runs** opens History
with the report's date range, filters, and row dimensions applied. Item drill-through uses
the same positive cargo-change definition as the report and does not replace the global
History search.

The preview intentionally does not include saved reports, arbitrary report charts, pivot
layouts, report CSV export, or more than two user-selected breakdown dimensions.
