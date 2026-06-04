import * as d3 from "d3";

export function createCaliforniaProjection(feature, width, height, padding = 32) {
  const projection = d3.geoMercator();
  const fitted = fitProjectionState(feature, width, height, padding);
  projection.scale(fitted.scale).translate(fitted.translate);
  return projection;
}

export function fitProjectionState(feature, width, height, padding = 32) {
  const safeWidth = Math.max(320, width);
  const safeHeight = Math.max(360, height);
  const safePadding = Math.min(padding, safeWidth / 4, safeHeight / 4);

  const projection = d3.geoMercator().fitExtent(
    [
      [safePadding, safePadding],
      [safeWidth - safePadding, safeHeight - safePadding]
    ],
    feature
  );

  return {
    scale: projection.scale(),
    translate: projection.translate()
  };
}

export function featureCollection(features) {
  return {
    type: "FeatureCollection",
    features
  };
}
