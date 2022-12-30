lat_lon <- function (data) {
  return(st_transform(data, "+proj=longlat +datum=WGS84"))
}

mx_read <- function (filename) {
   st_data <- st_read(filename, quiet=TRUE);
   dropped <- st_zm(st_data, drop = T, what = "ZM")
   return(lat_lon(dropped));
}
