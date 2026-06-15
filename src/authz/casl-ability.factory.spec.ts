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

  it('POS/salón (E03): manager configura; staff opera pero NO configura', () => {
    const manager = factory.createForRoles(['manager']);
    expect(manager.can('create', 'Table')).toBe(true); // configura el salón
    expect(manager.can('manage', 'Kitchen')).toBe(true);

    const staff = factory.createForRoles(['staff']);
    expect(staff.can('create', 'Order')).toBe(true); // toma órdenes
    expect(staff.can('update', 'Table')).toBe(true); // abre mesa / solicita cuenta
    expect(staff.can('update', 'Kitchen')).toBe(true); // marca ítems
    expect(staff.can('create', 'Table')).toBe(false); // NO crea mesas/zonas
    expect(staff.can('delete', 'Zone')).toBe(false);
  });

  it('cobros (E04): staff cobra pero NO anula; manager gestiona Sale', () => {
    const staff = factory.createForRoles(['staff']);
    expect(staff.can('read', 'Sale')).toBe(true); // ver ventas/comprobantes
    expect(staff.can('create', 'Sale')).toBe(true); // cajero = staff → cobra
    expect(staff.can('update', 'Sale')).toBe(false); // anular = manager/owner
    expect(staff.can('delete', 'Sale')).toBe(false);

    const manager = factory.createForRoles(['manager']);
    expect(manager.can('manage', 'Sale')).toBe(true); // incl. anular ticket
  });

  it('costeo (E06): reutiliza Report — owner/manager leen y gestionan CIF; staff NO accede', () => {
    const owner = factory.createForRoles(['owner']);
    expect(owner.can('read', 'Report')).toBe(true); // ver costeo/márgenes
    expect(owner.can('manage', 'Report')).toBe(true); // escribir CIF

    const manager = factory.createForRoles(['manager']);
    expect(manager.can('read', 'Report')).toBe(true); // ver costeo
    expect(manager.can('manage', 'Report')).toBe(true); // registrar/editar CIF

    const staff = factory.createForRoles(['staff']);
    expect(staff.can('read', 'Report')).toBe(false); // costeo = info de gestión → 403
    expect(staff.can('manage', 'Report')).toBe(false);
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
