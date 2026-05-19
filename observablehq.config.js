import {readFileSync} from "node:fs";

const styles = readFileSync(new URL("./src/styles.css", import.meta.url), "utf8");

export default {
  title: "SLO Housing Map",
  root: "src",
  style: null,
  footer: false,
  head: `<style>${styles}</style>`
};
