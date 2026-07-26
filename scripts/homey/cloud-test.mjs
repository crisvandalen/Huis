#!/usr/bin/env node
// Snelle test van de cloud-verbinding (na eenmalige cloud-auth).
import { maakHomeyApi } from './cloud-client.mjs';
const { homey, api } = await maakHomeyApi();
const devices = await api.devices.getDevices();
console.log('Verbonden met ' + homey.name + ' via de cloud: ' + Object.keys(devices).length + ' apparaten.');
