const { registerBlockType } = wp.blocks;
const { createElement: el, Fragment } = wp.element;
const { useBlockProps, InspectorControls } = wp.blockEditor;
const { PanelBody, SelectControl, Placeholder } = wp.components;
const data = window.zionfoodBlocks;
for (const type of ['menu', 'order', 'reservations', 'hours', 'promotions']) {
    registerBlockType('zionfood/' + type, {
        apiVersion: 3,
        title: 'ZionFood — ' + data.labels['shortcode_' + type],
        description: data.labels['shortcode_' + type + '_help'],
        icon:
            type === 'reservations'
                ? 'calendar-alt'
                : type === 'hours'
                  ? 'clock'
                  : type === 'promotions'
                    ? 'tickets-alt'
                    : 'food',
        category: 'widgets',
        attributes: { location: { type: 'string', default: '' } },
        supports: { html: false },
        edit: ({ attributes, setAttributes }) =>
            el(
                Fragment,
                null,
                el(
                    InspectorControls,
                    null,
                    el(
                        PanelBody,
                        { title: 'ZionFood' },
                        el(SelectControl, {
                            label: data.labels.location,
                            help: data.labels.help_location_id,
                            value: attributes.location,
                            options: [
                                { label: data.labels.default_location, value: '' },
                                ...data.locations.map((l) => ({ label: l.name, value: l.public_id })),
                            ],
                            onChange: (location) => setAttributes({ location }),
                        })
                    )
                ),
                el(
                    'div',
                    useBlockProps(),
                    el(
                        Placeholder,
                        {
                            icon: 'food',
                            label: 'ZionFood — ' + data.labels['shortcode_' + type],
                            instructions: data.labels['shortcode_' + type + '_help'],
                        },
                        el('p', null, data.labels.block_live_preview)
                    )
                )
            ),
        save: () => null,
    });
}
