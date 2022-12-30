library(sf)
library(leaflet)
library(raster)

source("scripts/utils.R")

#Layer 1: bare earth raster 
hillshade <- raster("spatial_data/rasters/Sample.tif")

#Render leaflet map

#Create palette
pal <- colorNumeric(c("#0C2C84", "#41B6C4", "#FFFFCC"), values(hillshade),
                    na.color = "transparent")

rasterMap <- leaflet() %>%
  addTiles(options = providerTileOptions(opacity = 0.5)) %>%
  addRasterImage(hillshade, colors = pal, opacity = 0.8)
 
print(rasterMap)