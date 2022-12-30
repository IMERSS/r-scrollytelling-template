library(sf)
library(leaflet)
library(dplyr)

source("scripts/utils.R")

#Layer 1: Sample vector
Sample <- mx_read("spatial_data/vectors/Shp_files/Sample")

baseMap <- leaflet() %>%
  addTiles(options = providerTileOptions(opacity = 0.5)) %>%
  addPolygons(data = Sample, color = "blue", weight = 2, fillOpacity = 0) %>%
  fitBounds(-123.564, 48.802, -123.516, 48.855)

print(baseMap)
