### deploy
- In GitHub, go to Settings > Pages and set Source to "GitHub Actions".
- The `Deploy GitHub Pages` workflow builds `dist/`, writes `api/forecast.json`, and publishes it as a project page.
- The scheduled workflow refreshes the static forecast snapshot hourly.

### next ideas
- move the 'best window' in a more easily recognizable location, give it unique color/formatting, and add illustrations
  - highlight the columns which correspond to the top few windows
  - add a tooltip to the 'best window' which shows how the composite score is calculated
