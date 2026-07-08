import { mongoose, ExpressRouter } from "#lib";

const Schema = mongoose.Schema;
const Model = mongoose.model;
const Router = () => ExpressRouter();

export { Schema, Model, Router };
