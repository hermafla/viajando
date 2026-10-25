import test from 'node:test';
import assert from 'node:assert/strict';
import Discount from '../discount-display.js';

const money=(amount,currency='USD')=>`${currency} ${Number(amount).toFixed(2)}`;
const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

test('shows verified provider savings with the previous and current room price',()=>{
  const offer={currency:'USD',offerInitialPrice:200,retailRate:150,promotions:[{name:'Oferta anticipada'}]};
  const details=Discount.details(offer);
  assert.equal(details.hasPriceDiscount,true);
  assert.equal(details.saved,50);
  assert.equal(details.percent,25);
  const html=Discount.markup(offer,money,esc);
  assert.match(html,/USD 200\.00/);
  assert.match(html,/USD 150\.00/);
  assert.match(html,/USD 50\.00 \(25%\)/);
  assert.match(html,/Oferta anticipada/);
});

test('shows promotion name without inventing a comparison when Nuitee gives no original price',()=>{
  const html=Discount.markup({retailRate:150,promotions:[{name:'Member rate'}]},money,esc);
  assert.match(html,/Promoción disponible/);
  assert.match(html,/Member rate/);
  assert.doesNotMatch(html,/Antes|ahorrás/);
});

test('does not show a discount when original price is not higher and no promotion was returned',()=>{
  assert.equal(Discount.markup({offerInitialPrice:150,retailRate:150},money,esc),'');
});

test('uses suggested selling price as a clearly labelled reference when no explicit sale price exists',()=>{
  const offer={currency:'USD',retailRate:1347.59,offerInitialPrice:1347.59,suggestedSellingPrice:1408.85};
  const details=Discount.details(offer);
  assert.equal(details.hasPriceDiscount,true);
  assert.equal(details.referenceLabel,'Precio de referencia Nuitee');
  assert.equal(details.original,1408.85);
  assert.equal(details.current,1347.59);
  assert.equal(details.percent,4);
  const html=Discount.markup(offer,money,esc);
  assert.match(html,/Precio de referencia Nuitee/);
  assert.match(html,/USD 1408\.85/);
  assert.match(html,/USD 1347\.59/);
  assert.doesNotMatch(html,/Antes/);
});
