import { CaslAbilityFactory } from './casl-ability.factory';

describe('CaslAbilityFactory (HU-01-04 matriz de permisos)', () => {
  const factory = new CaslAbilityFactory();

  it('owner puede gestionar todo', () => {
    const a = factory.createForRoles(['owner']);
    expect(a.can('manage', 'all')).toBe(true);
    expect(a.can('update', 'User')).toBe(true);
    expect(a.can('read', 'Report')).toBe(true);
  });

  it('manager lee todo y gestiona operativo, pero NO escribe usuarios ni settings', () => {
    const a = factory.createForRoles(['manager']);
    expect(a.can('read', 'User')).toBe(true);
    expect(a.can('read', 'Report')).toBe(true);
    expect(a.can('manage', 'Recipe')).toBe(true);
    expect(a.can('update', 'User')).toBe(false);
    expect(a.can('update', 'Setting')).toBe(false);
  });

  it('staff solo lee operativo; NO reportes, usuarios ni settings', () => {
    const a = factory.createForRoles(['staff']);
    expect(a.can('read', 'Inventory')).toBe(true);
    expect(a.can('read', 'Report')).toBe(false); // Gherkin: staff → reportes → 403
    expect(a.can('read', 'User')).toBe(false);
    expect(a.can('update', 'Setting')).toBe(false);
  });

  it('catálogo: owner/manager gestionan; staff solo lee', () => {
    expect(factory.createForRoles(['owner']).can('manage', 'Catalog')).toBe(
      true,
    );
    expect(factory.createForRoles(['manager']).can('create', 'Catalog')).toBe(
      true,
    );
    expect(factory.createForRoles(['staff']).can('read', 'Catalog')).toBe(true);
    expect(factory.createForRoles(['staff']).can('create', 'Catalog')).toBe(
      false,
    );
  });
});
