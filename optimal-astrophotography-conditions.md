# Optimal Astrophotography Conditions

This dashboard turns the Clear Dark Sky forecast rows into a single 0-100 composite observing score. The score is intended to answer a practical question: "If I can only image for a few hours, which dark windows are most likely to produce usable frames?"

It is not a physical sky-quality model. It is a weighted heuristic built from the rows currently parsed from Clear Dark Sky, with the heaviest weight placed on the variables that most directly affect astrophotography yield.

## Current composite score

For each hourly slot, the app reads the forecast entries at that time and computes:

```text
composite =
  cloud cover score      * 0.28 +
  ECMWF cloud score      * 0.14 +
  transparency score     * 0.20 +
  seeing score           * 0.16 +
  darkness score         * 0.12 +
  smoke score            * 0.04 +
  wind score             * 0.04 +
  humidity score         * 0.02
```

That makes the score mostly about the sky:

| Factor | Weight | Why it matters |
| --- | ---: | --- |
| Cloud cover | 28% | Clouds are the strongest hard stop. Even excellent seeing and transparency do not help if the target is blocked. |
| ECMWF cloud | 14% | A second cloud model reduces dependence on one forecast source. Agreement between models is more valuable than either model alone. |
| Transparency | 20% | Haze, moisture, aerosols, and thin cloud reduce contrast, especially for faint nebulae, galaxies, and IFN. |
| Seeing | 16% | Atmospheric steadiness controls star size and fine detail, especially for long focal lengths, planets, small galaxies, and high-resolution lunar work. |
| Darkness | 12% | Twilight, Moon altitude, Moon illumination, and limiting magnitude affect sky background and faint-object contrast. |
| Smoke | 4% | Smoke is treated as a secondary transparency penalty. It matters more for broadband and faint targets than for bright narrowband work. |
| Wind | 4% | Wind affects guiding, star shape, vibration, and mount stability. |
| Humidity | 2% | Humidity is a proxy for dew risk and transparency degradation. The app separately displays dew risk using humidity plus wind. |

The code intentionally separates "chart color" from "composite score." Each row gets its own 0-100 score and display color. The composite then combines those row scores using the weights above.

## Row scoring behavior

The row scores come from the parsed Clear Dark Sky values:

- Cloud cover: `100 - cloudPercent`. Clear is 100, overcast is 0, and percentages map directly.
- ECMWF cloud: same scoring as cloud cover.
- Transparency: word mapping. Transparent is 100, above average is 86, average is 68, below average is 42, poor is 20, cloudy is very low.
- Seeing: word mapping. Excellent is 100, good is 84, average is 66, poor is 38, bad is 18, cloudy is very low.
- Darkness: daylight is 0, civil twilight is 18, otherwise limiting magnitude is scaled roughly as `limitingMag / 6.5 * 100`.
- Smoke: no smoke is 100; increasing smoke lowers the score.
- Wind: 0-5 mph is ideal, 6-11 mph is still good, and high wind becomes a strong penalty.
- Humidity: under 70% is favorable; 80-90% becomes risky; 90%+ is poor.
- Temperature: currently scored for comfort and equipment behavior, but it is not part of the composite weight set.

Night score graphs only use nighttime slots. A slot is considered night if the parsed darkness row indicates Sun altitude below -6 degrees or limiting magnitude at least 3. If darkness data is missing, the fallback is a simple local-hour estimate of 19:00 through 06:00.

## What makes a good composite score

The useful interpretation is:

| Composite | Practical meaning |
| ---: | --- |
| 85-100 | Excellent. Clouds are low, transparency/seeing are strong, and darkness is sufficient. These are the sessions to prioritize. |
| 70-84 | Good. Usually worth imaging, especially if the weak factor does not matter for the selected target or setup. |
| 55-69 | Mixed. Use for forgiving targets, narrowband imaging, short focal lengths, testing, focusing, framing, or automation checks. |
| 40-54 | Marginal. Expect lower yield, more rejected subs, or target-specific compromises. |
| Under 40 | Poor. Usually not worth a serious imaging session unless the goal is equipment testing or opportunistic gaps. |

A high score usually means all of these are true:

- Cloud forecasts are mostly clear or low percentage in both cloud rows.
- Transparency is average or better.
- Seeing is average or better for the image scale being used.
- The sky is actually dark enough for the target, not just after sunset.
- Smoke, wind, and humidity are not severe enough to create a hidden failure mode.

The best sessions are not always the absolute highest single hour. The app finds a best window by looking for contiguous nighttime hours within 10 points of the best hour, with a minimum threshold of 55. This avoids over-valuing a single isolated peak.

## Important limitations

The current score is intentionally simple:

- It does not know the target. A Moon-lit night can still be good for planets, the Moon, star clusters, or narrowband emission nebulae, but poor for faint broadband targets.
- It does not know the equipment. A short refractor tolerates worse seeing and wind than a long focal-length SCT.
- It treats the two cloud rows as independent, but does not compute a true model-spread confidence value.
- It does not hard-cap the score when one severe condition should veto the session. For example, extreme wind or heavy cloud could be handled as a cap rather than only a weighted penalty.
- It uses Clear Dark Sky's parsed limiting magnitude rather than a local sky brightness model.
- It treats humidity as a weak penalty. That is reasonable for the composite, but dew risk can be a hard operational problem.

## Improvements with publicly accessible data

The score could be made more robust by adding public data sources and separating the model into three layers: sky clarity, sky darkness, and operational risk.

### 1. Better cloud confidence

Current cloud scoring combines Clear Dark Sky cloud cover and ECMWF cloud cover, but the app could explicitly score agreement between models.

Public sources:

- [NOAA High-Resolution Rapid Refresh (HRRR) on AWS](https://registry.opendata.aws/noaa-hrrr-pds/) provides hourly updated 3 km model data and is useful for short-range cloud, wind, humidity, and temperature signals.
- [ECMWF Open Data](https://www.ecmwf.int/en/forecasts/datasets/open-data) provides real-time forecast data on a rolling archive basis.
- [NWS API](https://www.weather.gov/documentation/services-web-api) provides forecasts, alerts, observations, and other open weather data.

Potential scoring change:

```text
cloudScore = weighted median of cloud models
cloudConfidence = 100 - modelSpreadPenalty
finalCloudContribution = cloudScore * confidenceMultiplier
```

This would distinguish "all models agree it will be clear" from "one model says clear and another says overcast."

### 2. Hard caps for hard stops

Weighted averages can hide veto conditions. A night with excellent darkness and seeing should still be capped if clouds are heavy.

Potential caps:

- If primary cloud cover is over 80%, cap composite at 30.
- If both cloud models are over 60%, cap composite at 45.
- If Sun altitude is above -6 degrees, cap composite at 35 for deep-sky imaging.
- If wind is above the equipment-specific safe threshold, cap composite at 50 or lower.
- If humidity is high and wind is calm, cap or flag for dew risk.

This preserves the composite for ranking normal nights while making severe cases behave more realistically.

### 3. Target-aware scoring

The optimal conditions depend on the target.

Examples:

- Broadband galaxies: require darkness, transparency, and low Moon impact.
- Emission nebulae with narrowband filters: tolerate Moon and some transparency loss better.
- Planetary imaging: seeing matters more than darkness or transparency.
- Wide-field Milky Way: cloud, transparency, Moon, and sky brightness dominate; seeing matters much less.

Potential scoring change:

```text
profile = broadband | narrowband | planetary | lunar | widefield
weights = profile-specific weights
targetAltitudePenalty = penalty from target altitude and airmass
moonSeparationPenalty = penalty from angular distance to Moon
```

Sun/Moon geometry can be derived from public astronomy services such as the [U.S. Naval Observatory Astronomical Applications API](https://aa.usno.navy.mil/data/api.html), which provides public Sun and Moon data services.

### 4. Better darkness and light pollution model

The current darkness row is useful, but a stronger model would estimate sky brightness from:

- Sun altitude.
- Moon altitude.
- Moon illumination.
- Angular separation between Moon and target.
- Baseline light pollution at the site.
- Aerosols, humidity, and snow cover when available.

Public sources:

- [NASA Earthdata Nighttime Lights backgrounder](https://www.earthdata.nasa.gov/learn/backgrounders/nighttime-lights) describes VIIRS nighttime lights data.
- [VIIRS Nighttime Day/Night Annual Band Composites in Google Earth Engine](https://developers.google.com/earth-engine/datasets/catalog/NOAA_VIIRS_DNB_ANNUAL_V21) provide public-domain annual nighttime lights composites.
- [NASA Black Marble / artificial light at night datasets](https://data.nasa.gov/dataset/annual-summary-of-artificial-light-at-night-from-viirs-s-npp-at-conus-county-and-census-tr-f6580) can help build a fixed site light-pollution baseline.

Potential scoring change:

```text
darknessScore =
  astronomicalDarknessScore
  - moonSkyglowPenalty
  - siteLightPollutionPenalty
  - snowOrAerosolBoostPenalty
```

### 5. Dew and frost risk as operational risk

Humidity alone is not enough. Dew depends on air temperature, dew point, wind, radiative cooling, and equipment temperature.

Public sources:

- NWS API and METAR observations can provide temperature, dew point, wind, cloud cover, and nearby station observations.
- [Aviation Weather Center data API](https://aviationweather.gov/data/api) can provide METAR data where nearby stations are useful.
- HRRR can provide forecast temperature, humidity, and wind at high spatial resolution.

Potential scoring change:

```text
dewRisk =
  dewPointSpreadScore
  + calmWindPenalty
  + clearSkyRadiativeCoolingPenalty

composite = composite - dewRiskPenalty
```

This should probably remain partly separate from sky quality because dew heaters, lens hoods, and local microclimate can change the operational outcome.

### 6. Smoke, aerosols, and PM2.5

Smoke can ruin transparency even when cloud forecasts look excellent. The current smoke score is useful, but it could be strengthened with real-time and forecast aerosol data.

Public sources:

- HRRR/RRFS smoke and dust model products from NOAA are relevant for smoke and aerosol transport.
- [AirNow API](https://docs.airnowapi.org/about) provides public access to real-time and forecast air quality data, with the caveat that official regulatory data comes from EPA AQS/AirData.
- [EPA AQS API](https://aqs.epa.gov/aqsweb/documents/data_api.html) is useful for historical calibration, not real-time decisions.

Potential scoring change:

```text
transparencyScore =
  baseTransparencyFromForecast
  - smokeColumnPenalty
  - surfacePM25Penalty
  - aerosolOpticalDepthPenalty
```

### 7. Seeing model improvements

Seeing is one of the hardest variables to forecast locally. A better model would combine Clear Dark Sky seeing with atmospheric profile signals:

- Jet stream strength.
- Winds aloft and vertical wind shear.
- Boundary-layer turbulence.
- Temperature gradient near the surface.
- Rapid pressure changes.
- Local terrain exposure.

Public sources:

- HRRR/RAP atmospheric profiles and winds aloft.
- NWS and aviation forecast products for winds and stability.
- Historical local image FWHM/HFR measurements from the user's own imaging sessions.

The best improvement here may be calibration: record actual star FWHM/HFR from completed sessions and learn how the public forecast variables behave at this site.

### 8. Historical calibration

The current score is human-designed. It could become site-calibrated.

For each imaging session, store:

- Forecast row values.
- Composite score at capture time.
- Target type.
- Filter type.
- Focal length / image scale.
- Guiding RMS.
- Median FWHM/HFR.
- Number and percentage of rejected subs.
- Sky background / median ADU.

Then fit weights to predict actual yield. Public historical weather data from [NOAA NCEI web services](https://www.ncdc.noaa.gov/cdo-web/webservices) can fill gaps for observed humidity, wind, temperature, and cloud/ceiling records.

## Suggested next scoring model

A more mature model could keep the current composite but add confidence and caps:

```text
baseSkyScore =
  cloud * 0.30 +
  transparency * 0.22 +
  seeing * 0.16 +
  darkness * 0.16 +
  smoke * 0.06 +
  wind * 0.05 +
  dew * 0.05

confidence =
  cloudModelAgreement * 0.50 +
  forecastLeadTimeConfidence * 0.25 +
  recentObservationAgreement * 0.25

targetAdjustedScore =
  applyTargetProfile(baseSkyScore)
  - moonTargetPenalty
  - targetAltitudePenalty

finalScore =
  applyHardCaps(targetAdjustedScore) * confidence
```

The current score is a good first-pass ranking tool. The highest-value improvements would be:

1. Add hard caps for cloud, daylight/twilight, wind, and dew risk.
2. Add model agreement/confidence for cloud cover.
3. Add target profiles: broadband, narrowband, planetary, lunar, and widefield.
4. Add Moon-target separation and target altitude.
5. Calibrate weights against actual imaging outcomes.

