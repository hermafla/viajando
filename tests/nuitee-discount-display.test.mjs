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
