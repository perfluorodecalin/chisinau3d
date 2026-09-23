# Bridge model anomaly report

Generated from the checked-in map snapshot and estimated bridge profiles. Reproduce with `npm run report:bridges` after `python3 scripts/prepare_bridges.py`; neither command requests map data from the network.

The saved map sections omit OSM node IDs. The model uses recorded road joins where available and infers some connections from coincident endpoints. Its 6 m landing offset and 6.5% approach *offset taper* are assumptions, not surveyed dimensions. The DEM under bridges can be unreliable.

- Source fingerprint: cdc9c47737e80ba9; terrain fingerprint: 236900aebb605c52
- Bridge ways: 282; non-bridge profiles: 1398; directly linked to bridge endpoints: 513
- Short spans: 190 under 20 m (22 under 5 m)
- Slope diagnostics: 14 bridge ways over 10%; 359 linked profiles over 6.5% slope (screening threshold, not a design grade limit)
- Bridge endpoint links within 1 m: 16

## Shortest bridge ways

| Way | Name | Type | Length | Max grade | Min deck-to-DEM |
| --- | --- | --- | ---: | ---: | ---: |
| 1530298774 | Mapped bridge | footway | 1.8 m | 5.9% | 6.0 m |
| 846617744 | Mapped bridge | steps | 2.1 m | 7.0% | 6.0 m |
| 114274977 | Mapped bridge | footway | 2.9 m | 33.7% | 6.0 m |
| 930686157 | Mapped bridge | footway | 2.9 m | 7.8% | 6.0 m |
| 114274972 | Mapped bridge | footway | 2.9 m | 13.4% | 6.0 m |
| 914464190 | Mapped bridge | footway | 3.0 m | 8.0% | 6.0 m |
| 930686155 | Mapped bridge | footway | 3.3 m | 0.9% | 6.0 m |
| 914092263 | Mapped bridge | footway | 3.5 m | 9.9% | 6.0 m |
| 932936386 | Mapped bridge | footway | 4.0 m | 3.6% | 6.0 m |
| 934222274 | Strada Schinoasa-Vale | living_street | 4.3 m | 0.6% | 6.0 m |

## Steepest bridge profiles

| Way | Name | Length | Max grade | Segment |
| --- | --- | ---: | ---: | ---: |
| 114274977 | Mapped bridge | 2.9 m | 33.7% | 0 |
| 935500895 | Mapped bridge | 5.5 m | 32.2% | 0 |
| 1025138164 | Mapped bridge | 7.4 m | 21.7% | 0 |
| 93422429 | Mapped bridge | 30.5 m | 18.6% | 4 |
| 1273638855 | Mapped bridge | 9.4 m | 15.9% | 0 |
| 892105947 | Mapped bridge | 4.7 m | 13.8% | 0 |
| 114274972 | Mapped bridge | 2.9 m | 13.4% | 0 |
| 909369617 | Mapped bridge | 5.5 m | 12.8% | 1 |
| 911889348 | Mapped bridge | 6.8 m | 12.8% | 1 |
| 1363601070 | Mapped bridge | 11.1 m | 12.0% | 1 |

## Steepest linked approach slope diagnostics

| Way | Name | Max grade | Segment | Local X/Z |
| --- | --- | ---: | ---: | --- |
| 729747548 | Strada Cantonului | 64.0% | 105 | -68.8, -1913.0 |
| 935500894 |  | 41.4% | 1 | -6342.2, -4045.8 |
| 89611145 |  | 37.8% | 2 | -88.3, -1910.8 |
| 161536775 |  | 31.3% | 11 | 1788.0, 305.6 |
| 1475536839 |  | 30.1% | 22 | 5211.6, -2787.1 |
| 33530701 |  | 28.5% | 0 | 1835.3, 2753.8 |
| 755980455 |  | 28.4% | 18 | 59.2, 2091.9 |
| 1273638854 |  | 28.4% | 1 | -1520.8, 1167.8 |
| 1253510203 |  | 27.4% | 28 | 4222.6, -6574.7 |
| 846932769 |  | 26.9% | 9 | -1560.7, 2127.6 |

## Smallest deck-to-DEM separations (diagnostic only)

| Way | Name | Minimum deck-to-DEM | Local X/Z |
| --- | --- | ---: | --- |
| 358089303 | Strada Ismail | 2.8 m | 1938.7, 246.0 |
| 830813308 | Mapped bridge | 2.8 m | 2016.2, 2226.5 |
| 114274990 | Mapped bridge | 3.1 m | 1916.3, 242.2 |
| 24858481 | Strada Mihai Viteazul | 4.4 m | -72.6, -1935.3 |
| 847400602 | Bulevardul Dacia | 4.5 m | 938.1, 3143.1 |
| 25480033 | Bulevardul Dacia | 4.6 m | 951.5, 3130.2 |
| 25454481 | Strada Grădina Botanică | 5.0 m | 5535.6, 4445.0 |
| 94375147 | Mapped bridge | 5.0 m | 960.7, 3128.5 |
| 28702334 | Mapped bridge | 5.1 m | 2195.5, 4384.1 |
| 24776845 | Bulevardul Renașterii Naționale | 5.3 m | 1158.8, -1162.8 |

## Near-endpoint elevation differences (diagnostic)

| Way A | Way B | Bridge A | Bridge B | Elevation difference | Local X/Z |
| --- | --- | --- | --- | ---: | --- |
| 1022345878 | 1022345879 | true | false | 0.05 m | -3646.8, 3778.2 |
| 950153219 | 950153223 | false | true | 0.05 m | -3061.1, -2295.3 |
| 1423824540 | 1423824541 | true | false | 0.04 m | -5222.5, 1108.5 |
| 950153224 | 950153225 | true | false | 0.04 m | -3070.5, -2191.8 |
| 1489775775 | 1489775776 | true | false | 0.03 m | 9854.2, -1455.2 |
| 721041708 | 891058395 | false | true | 0.03 m | -1670.2, -850.2 |
| 1489775772 | 1489775773 | true | false | 0.02 m | 9866.0, -1442.3 |
| 24256252 | 24795242 | true | false | 0.00 m | -4896.3, -3333.5 |
| 24256252 | 25032397 | true | false | 0.00 m | -4952.0, -3335.5 |
| 24760758 | 24858481 | false | true | 0.00 m | 21.2, -2021.2 |

## Recorded bridge-to-approach attachment seams

Attachments with more than 0.1 m difference: 1.

| Bridge way | Approach way | Elevation difference | Local X/Z |
| --- | --- | ---: | --- |
| 1095147577 | 1096512990 | 0.37 m | 5177.6, 4879.7 |
| 845765755 | 25614632 | 0.09 m | 794.6, -1709.0 |
| 851666676 | 846617743 | 0.08 m | 2356.1, 1447.8 |
| 24858481 | 24760758 | 0.00 m | 21.2, -2021.2 |
| 24776845 | 24776848 | 0.00 m | 1138.5, -1142.6 |
| 24778560 | 24776848 | 0.00 m | 1080.9, -1085.3 |
| 24776859 | 24776860 | 0.00 m | 2053.7, -5182.1 |
| 24778560 | 24778559 | 0.00 m | 1040.0, -1045.0 |
| 24256252 | 24795242 | 0.00 m | -4896.3, -3333.5 |
| 358089303 | 24964689 | 0.00 m | 2039.8, 222.4 |

## Interpretation

Terrain clearance is a low-confidence diagnostic: it is deck elevation minus the saved DEM sampled beneath bridge vertices, and the DEM under bridges may not represent actual ground. Treat it as neither measured clearance nor a pass/fail threshold. Approach slopes are screening measurements against a 6.5% comparison threshold; the source’s 6.5% value is an offset taper assumption, not a grade requirement. Near-endpoint elevation differences are only possible discontinuities: close geometry does not establish shared-node topology or same-level connectivity, and grade-separated crossings can be nearby.
## Migration from the previous model

The previous checked-in model contained the same 282 bridge ways and 1,920 approach ways. This offline reconstruction selects 1,398 approaches, a subset of those previously elevated. The 522 omitted ways are not proof that their old elevations were wrong: the prepared map lacks OSM node IDs, and some pedestrian-to-road connections are intentionally left unjoined without stronger topology evidence. Inspect conspicuous ramps in the game before using this model as a visual reference for bridge redesign. The bridge deck profiles themselves remain close to their prior elevations because both versions use the same estimated 6 m landing anchors.
